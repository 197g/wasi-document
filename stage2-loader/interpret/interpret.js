import { WASI, File, PreopenDirectory } from "@bjorn3/browser_wasi_shim";
import wasm_config_module from 'cargo-wasi:wasi_loader';

async function loadInterpretedData(loader_data) {
  let loader_module = WebAssembly.compile(wasm_config_module);

  let stdin = new File(loader_data);
  let stdout = new File([]);
  let stderr = new File([]);
  let stddir = new PreopenDirectory(".", {
      "stdin": stdin,
      "stdout": stdout,
      "stderr": stderr,
  });

  let fds = [
    stddir.path_open(0, "stdin", 0).fd_obj,
    stddir.path_open(0, "stdout", 0).fd_obj,
    stddir.path_open(0, "stderr", 0).fd_obj,
    stddir,
  ];

  let wasi = new WASI(["wasi-loader-interpreter"], [], fds);
  let inst = await WebAssembly.instantiate(await loader_module, {
    "wasi_snapshot_preview1": wasi.wasiImport,
  });

  wasi.start(inst);
  return new Uint32Array(stdout.data.buffer);
}

export {
  loadInterpretedData,
};

export default loadInterpretedData;
