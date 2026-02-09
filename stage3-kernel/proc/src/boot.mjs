class RemoteElement {
  #elementFd;

  constructor(element, remote) {
    this.elementFd = element;
    this.remote = remote;
  }

  insert(innerHTML) {
    return this.remote.insert(this.elementFd, innerHTML);
  }

  replace(outerHTML) {
    this.remote.replace(this.elementFd, outerHTML);
    this._invalidate();
  }

  exec(fn_or_module, args, transfer) {
    return this.remote.exec(this.elementFd, fn_or_module, args, transfer);
  }

  _invalidate() {
    this.elementFd = 0;
  }
}

class RemoteEditPort {
  #elementFd;
  #elementFree;
  #port;
  #awaits;

  constructor(port) {
    this.port = port;
    this.elementFree = []
    this.elementFd = 1;
    this.awaits = new Map();

    this.port.onmessage = (ev) => this._handle_results(ev);
  }

  select(selectors) {
    const _nothing = JSON.stringify(selectors);
    const ed = this._allocateEd();

    this.port.postMessage({
      'element-select': {
        ed: ed,
        selectors: selectors,
      }
    });

    return ed;
  }

  insert(ed, innerHTML) {
    this.port.postMessage({
      'element-insert': {
        ed: ed,
        innerHTML: innerHTML,
      }
    });
  }

  replace(ed, outerHTML) {
    this.port.postMessage({
      'element-replace': {
        ed: ed,
        outerHTML: outerHTML,
      }
    });

    this._deallocateEd(ed);
  }

  exec(ed, fn_or_module, args, transfer) {
    if (!(fn_or_module instanceof String)) {
      fn_or_module = fn_or_module.toString();
    }

    var ret = this._allocateEd();
    var result = Promise.withResolvers();
    result.promise.finally(() => this._deallocateEd(ret));

    this.awaits.set(ret, new WeakRef(result));

    this.port.postMessage({
      'element-exec': {
        ed: ed,
        fn: fn_or_module,
        args: args,
        ret,
      },
      transfer: transfer,
    });

    return result;
  }

  _allocateEd() {
    var ed;
    if ((ed = this.elementFree.pop()) !== undefined) {
      return ed;
    }

    ed = this.elementFd;
    this.elementFd += 1;

    // Reached Float precision.. That's 2**52 concurrent ed.
    if (ed == this.elementFd) {
      throw 'Out of unique element IDs';
    }

    return ed;
  }

  _deallocateEd(ed) {
    this.elementFree.push(ed);
  }

  _handle_results(event) {
    if (event.data.completed) {
      const {ed, result} = event.data.completed;
      this.awaits.get(ed)?.deref()?.resolve?.(result);
      this.awaits.delete(ed);
    }
  }
}

class ProcessSettled {
  #configuration;
  #imports;
  #element;

  constructor(configuration, imports, element) {
    this.configuration = configuration;
    this.imports = imports;
    this.element = element;
  }

  file_data(path) {
    return this.configuration.fds[3]
      ?.path_open(0, path, 0, 0)
      ?.fd_obj
      ?.file.data.buffer;
  }

  remote() {
    return this.element.remote;
  }

  insert(output) {
    this.element.insert(output);
  }

  replace(output) {
    this.element.replace(output);
  }

  exec(fn_or_module, args, transfer) {
    this.element.exec(fn_or_module, args, transfer);
  }

  async dispatch({ executable, args, stdin, stdout, stderr, element }) {
    const root_fs = this.configuration.fds[3];
    const post_process = root_fs
      ?.path_open(0, executable, 0, 0)
      ?.fd_obj;

    let blob = new Blob([post_process.file.data.buffer], { type: 'application/wasm' });

    let wasm = await WebAssembly.compileStreaming(new Response(blob));

    // FIXME: no, we do not want to default these paths. The respective files
    // should be simulated and not bound to any path in the file system. Also
    // like have a `/dev/null` right?
    var fds = [];
    fds[0] = root_fs?.path_open(0, stdin || 'stdin', 1, 1)?.fd_obj;
    fds[1] = root_fs?.path_open(0, stdout || 'stdout', 1, 1)?.fd_obj;
    fds[2] = root_fs?.path_open(0, stderr || 'stderr', 1, 1)?.fd_obj;
    fds[3] = root_fs;
    console.log(fds);

    let newWasi = new this.configuration.WASI(args, [], fds);
    var wasi_imports = { 'wasi_snapshot_preview1': newWasi.wasiImport };
    const instance = await WebAssembly.instantiate(wasm, wasi_imports);

    try {
      await newWasi.start({ 'exports': instance.exports });
    } catch (e) {
      if (typeof(e) == 'string' && e == 'exit with exit code 0') {} else {
        throw e;
      }
    }

    var element = new RemoteElement(element, this.element.remote);
    return new ProcessSettled(newWasi, wasi_imports, element);
  }
}

export default async function(configuration) {
  /* Problem statement:
   * We'd like to solve the problem of exporting our current WASI for use by
   * wasm-bindgen. It is not currently supported to pass such additional
   * imports as a parameter to the init function of wasm-bindgen. Instead, the
   * module generated looks like so:
   *
   *     import * as __wbg_star0 from 'wasi_snapshot_preview1';
   *     // etc.
   *     imports['wasi_snapshot_preview1'] = __wbg_star0;
   *
   * Okay. So can we setup such that the above `wasi_snapshot_preview1` module
   * refers to some shim that we control? Not so easy. We can not simply create
   * an importmap; we're already running in Js context and it's forbidden to
   * modify after that (with some funny interaction when rewriting the whole
   * document where warnings are swallowed?). See `__not_working_via_importmap`.
   *
   * Instead, we will hackishly rewrite the bindgen import if we're asked to.
   * Create a shim module that exports the wasi objects' import map, and
   * communicate with the shim module via a global for lack of better ideas. I
   * don't like that we can not reverse this, the module is cached, but oh
   * well. Let's hope for wasm-bindgen to cave at some point. Or the browser
   * but 'Chromium does not have the bandwidth' to implement the dynamic remap
   * feature already in much smaller products. And apparently that is the
   * motivation not to move forward in WICG. Just ____ off. When talking about
   * Chrome monopoly leading to bad outcomes, this is one. And no one in
   * particular is at fault of course.
   */
  async function reap_into_inner_text(proc) {
    const [stdin, stdout, stderr] = proc.configuration.fds;
    proc.element.innerText = new TextDecoder().decode(stdout.file.data);
    proc.element.title = new TextDecoder().decode(stderr.file.data);
  }

  console.log('Reached stage3 successfully', configuration);
  const wasm = configuration.wasm_module;
  const remote = new RemoteEditPort(configuration.port);

  let newWasi = new configuration.WASI(configuration.args, configuration.env, configuration.fds);

  const kernel_bindings = WebAssembly.Module.customSections(wasm, 'wah_polyglot_wasm_bindgen');

  // A kernel module is any Module which exposes a default export that conforms
  // to our call interface. It will get passed a promise to the wasmblob
  // response of its process image and should be an awaitable that resolves to
  // the exports from the module. Simplistically this could be the `exports`
  // attribute from the `Instance` itself.
  let kernel_module = undefined;
  if (kernel_bindings.length > 0 && false) {
    // fIXME: no longer implemented under WebWorker sandbox. But the code is also not ready to target both environments transparently.
    document.__wah_wasi_imports = newWasi.wasiImport;

    // Create a module that the kernel can `import` via ECMA semantics. This
    // enables such kernel modules to be independent from our target. In fact,
    // we do expect them to be created via Rust's `wasm-bindgen` for instance.
    let testmodule = Object.keys(document.__wah_wasi_imports)
      .map((name, _) => `export const ${name} = document.__wah_wasi_imports.${name};`)
      .join('\n');
    let wasi_blob = new Blob([testmodule], { type: 'application/javascript' });
    let objecturl = URL.createObjectURL(wasi_blob);

    // FIXME: should be an import map where `wasi_snapshot_preview1` is an
    // alias for our just created object URL module.
    const wbg_source = new TextDecoder().decode(kernel_bindings[0])
      .replace('wasi_snapshot_preview1', objecturl);

    let wbg_blob = new Blob([wbg_source], { type: 'application/javascript' });
    let wbg_url = URL.createObjectURL(wbg_blob);
    kernel_module = await import(wbg_url);
  }

  const rootdir = configuration.fds[3];
  configuration.fds[0] = rootdir.path_open(0, "proc/0/fd/0", 0, 1).fd_obj;
  configuration.fds[1] = rootdir.path_open(0, "proc/0/fd/1", 0, 1).fd_obj;
  configuration.fds[2] = rootdir.path_open(0, "proc/0/fd/2", 0, 1).fd_obj;
  configuration.args.length = 0;

  const input_decoder = new TextDecoder('utf-8');
  const assign_arguments = (path, push_with, cname) => {
    cname = cname || 'cmdline';
    let cmdline = undefined;
    if (cmdline = rootdir.path_open(0, path, 0, 1).fd_obj) {
      let data = cmdline.file.data;
      let nul_split = -1;
      while ((nul_split = data.indexOf(0)) >= 0) {
        const arg = data.subarray(0, nul_split);
        push_with(input_decoder.decode(arg));
        data = data.subarray(nul_split + 1);
      }

      push_with(input_decoder.decode(data));
    } else {
      console.log('No initial', cname);
    }
  }

  assign_arguments("proc/0/cmdline", (e) => configuration.args.push(e), "cmdline");
  assign_arguments("proc/0/environ", (e) => configuration.env.push(e), "environ");

  let reaper = [];

  try {
    console.log('Dispatch stage3 into init', configuration);
    var wasi_imports = { 'wasi_snapshot_preview1': newWasi.wasiImport };

    // FIXME: hardcoded, should be configurable. Also if we launch multiple
    // process instances concurrently then they are configured by finding a
    // number of `<template>` elements that contain instructions for a
    // derived configuration in that shared environment. Then the context is
    // that element itself, allowing it to be replaced with the actual
    // rendering intent.
    var element = remote.select([
      { 'by-id': 'wasi-document-init'},
      { 'by-tag-name': 'body'},
    ]);

    console.log('Using init element', element, configuration);

    // The init process controls the whole body in the end.
    reaper.push({
      configuration: configuration,
      // FIXME: hardcoded but permissible?
      post_module: reap_into_inner_text,
      // FIXME: hardcoded, should be configurable
      override_file: 'proc/0/display.mjs',
      // The element context.
      //
      // FIXME: replacement should also be possible early if we want to avoid
      // flicker. That is before this stops running. A balanced approach may be
      // enabled by WASI 0.2's component model where we have `async` / stream
      // functions. That is functions that yield to the host multiple times
      // before setting a result.
      element: element,
      imports: wasi_imports,
    });

    var source_headers = {};
    var wasi_exports = undefined;

    if (kernel_module !== undefined) {
      const wasmblob = new Blob([configuration.wasm], { type: 'application/wasm' });
      wasi_exports = await kernel_module.default(Promise.resolve(new Response(wasmblob, {
        'headers': source_headers,
      })));

      await newWasi.start({ 'exports': wasi_exports });
    } else {
      const instance = await WebAssembly.instantiate(wasm, wasi_imports);
      wasi_exports = instance.exports;
      await newWasi.start({ 'exports': wasi_exports });
    }
  } catch (e) {
    if (typeof(e) == 'string' && e == 'exit with exit code 0') {} else {
      console.dir(typeof(e), e);
      console.log('at ', e.fileName, e.lineNumber, e.columnNumber);
      console.log(e.stack);
      configuration.fallback_shell(configuration, e);
    }
  } finally {
    const [stdin, stdout, stderr] = configuration.fds;
    console.log('Result(stdin )', new TextDecoder().decode(stdin.file.data));
    console.log('Result(stdout)', new TextDecoder().decode(stdout.file.data));
    console.log('Result(stderr)', new TextDecoder().decode(stderr.file.data));
  }

  let display = await Promise.allSettled(reaper.map(async function(proc) {
    const override_file = proc.configuration.fds[3]
      ?.path_open(0, proc.override_file, 0, 0)
      ?.fd_obj;

    let post_handler = proc.post_module;

    if (override_file) {
      let blob = new Blob([override_file.file.data.buffer], { type: 'application/javascript' });
      let blobURL = URL.createObjectURL(blob);
      post_handler = (await import(blobURL)).default;
    }

    // FIXME: unclean. We expose all our WASI internals here. The exact classes
    // etc. While this may sometimes be necessary for precise control and the
    // layer is, after all, below us and thus our 'target platform' it would be
    // much nicer if we had a more fine-grained decision about the exposed
    // object where everything / most is opt-in and explicitly requested.
    var element = new RemoteElement(proc.element, remote);
    return await post_handler(new ProcessSettled(proc.configuration, proc.imports, element));
  }));

  let have_an_error = undefined;
  if ((have_an_error = display.filter(el => el.reason !== undefined)).length > 0) {
    configuration.fallback_shell(configuration, have_an_error);
  }
}
