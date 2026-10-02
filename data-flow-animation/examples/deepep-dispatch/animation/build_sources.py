import json,pathlib
root=pathlib.Path(__file__).resolve().parent.parent/'DeepEP-Ascend'
files=['deep_ep/include/deep_ep/impls/ep/dispatch.hpp','deep_ep/include/deep_ep/impls/ep/dispatch_copy_epilogue.hpp','deep_ep/include/deep_ep/layout/ep/token.hpp','deep_ep/include/deep_ep/layout/ep/workspace.hpp','deep_ep/include/deep_ep/comm/handle.hpp','deep_ep/buffers/ep.py','csrc/buffers/ep.hpp','csrc/kernels/ep/dispatch.hpp','deep_ep/include/deep_ep/comm/barrier.hpp']
data={'commit':'3b25377d04b24fc6154698ded78a2bcb2c59afff','files':{f:(root/f).read_text().splitlines() for f in files}}
(pathlib.Path(__file__).resolve().parent/'sources.json').write_text(json.dumps(data,ensure_ascii=False))
