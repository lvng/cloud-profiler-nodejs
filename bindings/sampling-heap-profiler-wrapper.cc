/**
 * Copyright 2015 Google Inc. All Rights Reserved.
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

#include <memory>
#include "v8-profiler.h"
#include "nan.h"

using namespace v8;

class HeapProfile : public Nan::ObjectWrap {
public:
  static NAN_MODULE_INIT(Init) {
    v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);
    tpl->InstanceTemplate()->SetInternalFieldCount(1);

    Nan::SetPrototypeMethod(tpl, "getRootName", GetRootName);

    constructor().Reset(Nan::GetFunction(tpl).ToLocalChecked());
  }

  static NAN_METHOD(NewInstance) {
    v8::Local<v8::Function> cons = Nan::New(constructor());
    double value = info[0]->IsNumber() ? Nan::To<double>(info[0]).FromJust() : 0;
    const int argc = 1;
    v8::Local<v8::Value> argv[1] = {Nan::New(value)};
    info.GetReturnValue().Set(Nan::NewInstance(cons, argc, argv).ToLocalChecked());
  }

private:
  AllocationProfile* profile_;
  explicit HeapProfile(AllocationProfile* profile) {
    profile_ = profile;
  }
  ~HeapProfile() {
    delete profile_;
  }

  static NAN_METHOD(New) {
    if (info.IsConstructCall()) {
      v8::AllocationProfile* profile = info.GetIsolate()->GetHeapProfiler()->GetAllocationProfile();
      HeapProfile * obj = new HeapProfile(profile);
      obj->Wrap(info.This());
      info.GetReturnValue().Set(info.This());
    } else {
      const int argc = 1;
      v8::Local<v8::Value> argv[argc] = {info[0]};
      v8::Local<v8::Function> cons = Nan::New(constructor());
      info.GetReturnValue().Set(Nan::NewInstance(cons, argc, argv).ToLocalChecked());
    }
  }

  static NAN_METHOD(GetRootName) {
    HeapProfile* obj = ObjectWrap::Unwrap<HeapProfile>(info.Holder());
    AllocationProfile::Node* root = obj->profile_->GetRootNode();
    info.GetReturnValue().Set(root->name);
  }

  static inline Nan::Persistent<v8::Function> & constructor() {
    static Nan::Persistent<v8::Function> my_constructor;
    return my_constructor;
  }

};

NAN_METHOD(StartSamplingHeapProfiler) {
  if (info.Length() == 2) {
    if (!info[0]->IsUint32()) {
      return Nan::ThrowTypeError("First argument type must be uint32.");
    }
    if (!info[1]->IsNumber()) {
      return Nan::ThrowTypeError("First argument type must be Integer.");
    }
    uint64_t sample_interval = info[0].As<Integer>()->Uint32Value();
    int stack_depth = info[1].As<Integer>()->IntegerValue();
    info.GetIsolate()->GetHeapProfiler()->
      StartSamplingHeapProfiler(sample_interval, stack_depth);
  } else {
    info.GetIsolate()->GetHeapProfiler()->StartSamplingHeapProfiler();
  }
}

NAN_METHOD(StopSamplingHeapProfiler) {
  info.GetIsolate()->GetHeapProfiler()->StopSamplingHeapProfiler();
}

NAN_MODULE_INIT(InitAll) {
  HeapProfile::Init(target);
  Nan::Set(target,
    Nan::New<v8::String>("getAllocationProfile").ToLocalChecked(),
    Nan::GetFunction(
      Nan::New<v8::FunctionTemplate>(HeapProfile::NewInstance)).ToLocalChecked()
  );
  Nan::Set(target, Nan::New("startSamplingHeapProfiler").ToLocalChecked(),
    Nan::GetFunction(Nan::New<FunctionTemplate>(StartSamplingHeapProfiler)).ToLocalChecked());
  Nan::Set(target, Nan::New("stopSamplingHeapProfiler").ToLocalChecked(),
    Nan::GetFunction(Nan::New<FunctionTemplate>(StopSamplingHeapProfiler)).ToLocalChecked());
}

NODE_MODULE(sampling_heap_profiler_wrapper, InitAll);
