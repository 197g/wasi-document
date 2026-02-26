class RemoteElement {
  #elementFd;
  #remote;

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

  _invalidate() {
    this.elementFd = 0;
  }
}

class RemoteEditPort {
  #elementFd;
  #elementFree;
  #port;
  #awaits;
  #wasi;
  #root_fs;
  #run_level;

  constructor(port, wasi, root_fs) {
    this.port = port;
    this.wasi = wasi;
    this.root_fs = root_fs;
    this.#run_level = {};

    this.elementFree = []
    this.elementFd = 1;
    this.awaits = new Map();

    this.commands = new Map();
    this.commands.set('completed', (ev) => this._handle_completed(ev));
    this.commands.set('create-proc', (ev) => this._handle_create_proc(ev));

    this.port.onmessage = (ev) => this._handle_message(ev);
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

  // Run a module in the context of the 'firmware' (stage 2).
  //
  // Its default export is called with the worker_state as parameter and
  // `options` as second parameter. Also `options.import` controls the `import`
  // call if present. `transfer` is used when one of the other arguments has a
  // transferable object (e.g. ArrayBuffer). Note we can not `createObjectURL`
  // within a worker hence passing the source and not a blob.
  add_module(module, type, options, transfer) {
    let ed = this._allocateEd();
    let result = this._awaitable(ed);

    this.port.postMessage({
      'module': {
        module,
        type,
        options,
        ed,
      },
      'transfer': transfer || [],
    });

    return result.promise;
  }

  firmware_exec(ed, fn_or_module, args, transfer) {
    if (!(fn_or_module instanceof String)) {
      fn_or_module = fn_or_module.toString();
    }

    var ret_ed = this._allocateEd();
    let result = this._awaitable(ret_ed);

    this.port.postMessage({
      'element-exec': {
        ed: ed,
        fn: fn_or_module,
        args: args,
        ret_ed,
      },
      transfer: transfer,
    });

    return result;
  }

  run_level(level) {
    Object.assign(this.#run_level, level);

    this.port.postMessage({
      'run-level': this.#run_level,
    });
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

  _awaitable(ret) {
    var result = Promise.withResolvers();
    result.promise.finally(() => this._deallocateEd(ret));
    this.awaits.set(ret, new WeakRef(result));
    return result;
  }

  _deallocateEd(ed) {
    this.elementFree.push(ed);
  }

  _handle_message(event) {
    let data = event.data;
    delete data.transfer;

    if (Object.keys(data).length != 1) {
      return this._signal_error({ invalid_message: event, origin: 'kernel' });
    }

    const [command, value] = Object.entries(data)[0];
    const handler = this.commands.get(command);

    try {
      if (handler) handler(value, this, { event: event });
    } catch (e) {
      return this._signal_error({ handler_error: e, origin: 'kernel' });
    }
  }

  _signal_error(error) {
    this.port.postMessage({
      error: error,
    });
  }

  _handle_create_proc(create) {
    const { executable, stdin, stdout, stderr, env, args, fid } = create;
    let binary = executable || args[0];
    this._dispatch({ binary, stdin, stdout, stderr, env, args }).then((settled) => {
      console.log('Process settled', fid);
      this._reap(fid, 0, settled.configuration);
    })
  }

  _reap(fid, status, wasi) {
    let transfer = [];

    let stdout = wasi.fds[1]?.file?.data;
    let stderr = wasi.fds[2]?.file?.data;

    transfer.push(stdout?.buffer);
    transfer.push(stderr?.buffer);

    this.port.postMessage({
      reap: {
        pid: '',
        fid,
        stdout,
        stderr,
      },
      transfer: transfer.filter(x => x !== undefined),
    })
  }

  _handle_completed(completed) {
    const {ed, result, error} = completed;
    const handler = this.awaits.get(ed);
    this.awaits.delete(ed);

    if (error) {
      handler?.deref()?.resolve?.(result);
    } else {
      handler?.deref()?.reject?.(result);
    }
  }

  async _dispatch({ binary, env, args, stdin, stdout, stderr, element }) {
    // FIXME: in a kernel we may have this pre-opened (exec from a memfd)
    if (binary == null) {
      console.error(...arguments);
      throw 'No binary specified';
    }

    const exec_binary = this.root_fs
      ?.path_open(0, ''+binary, 0, 0)
      ?.fd_obj;

    // FIXME: no, we do not want to default these paths. The respective files
    // should be simulated and not bound to any path in the file system. Also
    // like have a `/dev/null` right? We need to create our own Directory nodes
    // that are mounts.
    var fds = [];
    fds[0] = this._open_io(stdin);
    fds[1] = this._open_io(stdout);
    fds[2] = this._open_io(stderr);
    fds[3] = this.root_fs;

    let blob = new Blob([exec_binary.file.data.buffer], { type: 'application/wasm' });
    let wasm = await WebAssembly.compileStreaming(new Response(blob));

    let newWasi = new this.wasi(args, [], fds);
    var wasi_imports = { 'wasi_snapshot_preview1': newWasi.wasiImport };
    const instance = await WebAssembly.instantiate(wasm, wasi_imports);
	  console.log('Starting process ', newWasi);

    let status = 0;
    try {
      await newWasi.start({ 'exports': instance.exports });
    } catch (e) {
      if (typeof(e) == 'string' && e == 'exit with exit code 0') {} else {
        status = -1;
        throw e;
      }
    }

    var element = new RemoteElement(element, this);
    return new ProcessSettled(newWasi, wasi_imports, status, element);
  }

  _open_io(io) {
    function uuidv4() {
      return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
      );
    }

    let path = null;

    if (io.pipe) {
      path = 'io-' + uuidv4();
    } else if (io.file) {
      path = ''+io.file;
    } else if (io.null) {
      return null;
    } else {
      throw 'Invalid IO specification';
    }

    // Similar to Linux, all IO is open read-write internally :)
    return this.root_fs?.path_open(0, path, 1, 1)?.fd_obj;
  }
}

class ProcessSettled {
  #configuration;
  #imports;
  #status;

  constructor(configuration, imports, status) {
    this.configuration = configuration;
    this.imports = imports;
    this.status = status;
  }

  file_data(path) {
    let preopen = this.configuration.fds[3];
    let fd = preopen?.path_open(0, path, 0, 0);
    return fd?.fd_obj?.file.data.buffer;
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

  firmware_exec(fn_or_module, args, transfer) {
    this.element.firmware_exec(fn_or_module, args, transfer);
  }
}

export default async function(configuration) {
  console.log('Reached stage3 successfully', configuration);

  const wasm = configuration.wasm_module;
  const root_fs = configuration.fds[3];

  const remote = new RemoteEditPort(configuration.port, configuration.WASI, root_fs);
  let newWasi = new configuration.WASI(configuration.args, configuration.env, configuration.fds);

  remote.run_level({
    /* The kernel is done */
    'boot': 1,
    /* We provide filesystem access to the firmware */
    'filesystem': 1,
  });

  /* */
  const kernel_bindings = WebAssembly.Module.customSections(wasm, 'wah_polyglot_wasm_bindgen');

  configuration.fds[0] = root_fs.path_open(0, "proc/0/fd/0", 0, 1).fd_obj;
  configuration.fds[1] = root_fs.path_open(0, "proc/0/fd/1", 0, 1).fd_obj;
  configuration.fds[2] = root_fs.path_open(0, "proc/0/fd/2", 0, 1).fd_obj;
  configuration.args.length = 0;

  const input_decoder = new TextDecoder('utf-8');
  const assign_arguments = (path, push_with, cname) => {
    cname = cname || 'cmdline';
    let cmdline = undefined;
    if (cmdline = root_fs.path_open(0, path, 0, 1).fd_obj) {
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

  let bootdir = undefined;
  if (bootdir = root_fs?.dir.get_entry_for_path("boot")) {
    console.log('Found boot directory', bootdir);
    for (let [name, entry] of Object.entries(bootdir?.contents || [])) {
      console.log(name, entry);
      if (!name.match(/\.mjs$/)) {
        continue;
      }

      // Execute this mjs module
      let type = name.endsWith('.mjs') ? 'module' : 'application/typescript';
      remote.add_module(entry.data, type, {}, [entry.data.buffer]);
    }
  }

  remote.run_level({
    'create-proc': 1,
  });

  let reaper = [];

  try {
    console.log('Dispatch stage3 into init', configuration);
    var wasi_imports = { 'wasi_snapshot_preview1': newWasi.wasiImport };

    let executable = configuration.args[0] || 'proc/0/exe';
    const process = root_fs?.path_open(0, executable, 0, 0)?.fd_obj;
    let blob = new Blob([process.file.data.buffer], { type: 'application/wasm' });
    let wasm = await WebAssembly.compileStreaming(new Response(blob));

    console.log('Using init element', configuration);

    // The init process controls the whole body in the end.
    reaper.push({
      configuration: configuration,
      // FIXME: hardcoded but permissible?
      post_module: async () => {},
      // FIXME: hardcoded, should be configurable
      override_file: 'proc/0/display.mjs',
      imports: wasi_imports,
    });

    var source_headers = {};
    var wasi_exports = undefined;

    const instance = await WebAssembly.instantiate(wasm, wasi_imports);
    wasi_exports = instance.exports;
    await newWasi.start({ 'exports': wasi_exports });

    remote._reap(/*fid*/ 0, /*status*/ 0, newWasi);
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

  // Rest of this work done by bound element.onmessage.
}
