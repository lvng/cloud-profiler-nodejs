/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as delay from 'delay';
import * as extend from 'extend';
import * as gcpMetadata from 'gcp-metadata';
import * as path from 'path';
import {normalize} from 'path';
import * as pify from 'pify';
import * as semver from 'semver';

import {AuthenticationConfig, Common, ServiceConfig} from '../third_party/types/common-types';

import {Config, defaultConfig, ProfilerConfig} from './config';
import {Profiler} from './profiler';
import * as heapProfiler from './profilers/heap-profiler';

const common: Common = require('@google-cloud/common');
const pjson = require('../../package.json');

/**
 * @return value of metadata field.
 * Throws error if there is a problem accessing metadata API.
 */
async function getMetadataInstanceField(field: string): Promise<string> {
  const res = await gcpMetadata.instance(field);
  return res.data;
}

function hasService(config: Config):
    config is {serviceContext: {service: string}} {
  return config.serviceContext !== undefined &&
      typeof config.serviceContext.service === 'string';
}

/**
 * Sets unset values in the configuration to the value retrieved from
 * environment variables or specified in defaultConfig.
 * Throws error if value that must be set cannot be initialized.
 */
function initConfigLocal(config: Config): ProfilerConfig {
  config = common.util.normalizeArguments(null, config);

  const envConfig: Config = {
    projectId: process.env.GCLOUD_PROJECT,
    serviceContext: {
      service: process.env.GAE_SERVICE,
      version: process.env.GAE_VERSION,
    }
  };

  if (process.env.GCLOUD_PROFILER_LOGLEVEL !== undefined) {
    const envLogLevel = Number(process.env.GCLOUD_PROFILER_LOGLEVEL);
    if (!isNaN(envLogLevel)) {
      envConfig.logLevel = envLogLevel;
    }
  }

  let envSetConfig: Config = {};
  const val = process.env.GCLOUD_PROFILER_CONFIG;
  if (val) {
    envSetConfig = require(path.resolve(val)) as Config;
  }

  const mergedConfig =
      extend(true, {}, defaultConfig, envSetConfig, envConfig, config);

  if (!hasService(mergedConfig)) {
    throw new Error('Service must be specified in the configuration.');
  }

  return mergedConfig;
}

/**
 * Sets unset values in the configuration which can be retrieved from GCP
 * metadata.
 */
async function initConfigMetadata(config: ProfilerConfig):
    Promise<ProfilerConfig> {
  if (!config.zone || !config.instance) {
    const [instance, zone] =
        await Promise
            .all([
              getMetadataInstanceField('name'), getMetadataInstanceField('zone')
            ])
            .catch(
                (err: Error) => {
                    // ignore errors, which will occur when not on GCE.
                }) ||
        [undefined, undefined];
    if (!config.zone && zone) {
      config.zone = zone.substring(zone.lastIndexOf('/') + 1);
    }
    if (!config.instance && instance) {
      config.instance = instance;
    }
  }
  return config;
}

let profiler: Profiler|undefined = undefined;

/**
 * Initializes the config, and starts heap profiler if the heap profiler is
 * needed.
 */
export async function initConfigAndMaybeStartHeapProfiler(config: Config):
    Promise<ProfilerConfig> {
  let profilerConfig = initConfigLocal(config);

  // Start the heap profiler if profiler config does not indicate heap profiling
  // is disabled. This must be done before any asynchronous calls are made so
  // all memory allocations made after start() is called can be captured.
  if (!profilerConfig.disableHeap) {
    heapProfiler.start(
        profilerConfig.heapIntervalBytes, profilerConfig.heapMaxStackDepth);
  }
  profilerConfig = await initConfigMetadata(profilerConfig);
  return profilerConfig;
}

/**
 * Starts the profiling agent and returns a promise.
 * If any error is encountered when configuring the profiler the promise will
 * be rejected. Resolves when profiling is started.
 *
 * config - Config describing configuration for profiling.
 *
 * @example
 * profiler.start();
 *
 * @example
 * profiler.start(config);
 *
 */
export async function start(config: Config = {}): Promise<void> {
  if (!semver.satisfies(process.version, pjson.engines.node)) {
    logError(
        `Could not start profiler: node version ${process.version}` +
            ` does not satisfies "${pjson.engines.node}"`,
        config);
    return;
  }

  let normalizedConfig: ProfilerConfig;
  try {
    normalizedConfig = await initConfigAndMaybeStartHeapProfiler(config);
  } catch (e) {
    logError(`Could not start profiler: ${e}`, config);
    return;
  }

  profiler = new Profiler(normalizedConfig);
  profiler.start();
}

function logError(msg: string, config: Config) {
  const logger = new common.logger(
      {level: common.logger.LEVELS[config.logLevel || 2], tag: pjson.name});
  logger.error(msg);
}


/**
 * For debugging purposes. Collects profiles and discards the collected
 * profiles.
 */
export async function startLocal(config: Config = {}): Promise<void> {
  let normalizedConfig: ProfilerConfig;
  try {
    normalizedConfig = await initConfigAndMaybeStartHeapProfiler(config);
  } catch (e) {
    logError(`Could not start profiler: ${e}`, config);
    return;
  }

  profiler = new Profiler(normalizedConfig);
  while (true) {
    if (!config.disableHeap) {
      const heap = await profiler.profile(
          {name: 'HEAP-Profile' + new Date(), profileType: 'HEAP'});
    }
    if (!config.disableTime) {
      const wall = await profiler.profile({
        name: 'Time-Profile' + new Date(),
        profileType: 'WALL',
        duration: '10s'
      });
    }
    await delay(1000);
  }
}

// If the module was --require'd from the command line, start the agent.
if (module.parent && module.parent.id === 'internal/preload') {
  start();
}
