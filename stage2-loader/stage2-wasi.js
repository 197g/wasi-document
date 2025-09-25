import { WASI, File, OpenFile, Directory, PreopenDirectory } from "@bjorn3/browser_wasi_shim";
// This include is synthesized by `build.js:wasiInterpreterPlugin`.
import { load_config } from 'wasi-config:config.toml'

async function fallback_shell(configuration, error) {
  document.documentElement.innerHTML = `<p>Missing boot exec</p>`;

  if (error !== undefined) {
    document.documentElement.innerHTML = `<p>Error: ${error}</p>`;
  }

  document.documentElement.innerHTML += `<p>WAH rescue shell</p>`;
  // FIXME: here we would search for a special section, that can _optionally_
  // added if the file size is not too consequential. This would then contain
  // an actual shell compiled as a separate single-module ESM, a new stage2/SPA
  // basically.
  const rootfs = configuration.fds[3];

  function mkDirElement(dir) {
    const list = document.createElement('ul');
    for (const [name, entry] of Object.entries(dir.contents)) {
      const el = document.createElement('li');
      el.innerText = name;
      if (entry instanceof Directory) {
        const sublist = mkDirElement(entry);
        el.appendChild(sublist);
      } else {
        el.innerText = '';
        const btn = document.createElement('a');
        const blob = new Blob([entry.data]);
        btn.innerText = name;
        btn.download = name;
        btn.href = URL.createObjectURL(blob);
        el.appendChild(btn);
      }

      list.appendChild(el);
    }
    return list;
  };

  if (rootfs) {
    document.documentElement.innerHTML += `<p>Filesystem: </p>`;
    document.documentElement.appendChild(mkDirElement(rootfs.dir));
  }

  console.log(error);
}

async function mount({ module_or_path, wasi_root_fs, wasi_stage_url }) {
  const wasmbody = await (await module_or_path).arrayBuffer();

  // Absurdly hacky way to construct our worker.js source code.
  //
  // Problem 1: If we use `type: module` in the worker definition then Chromium
  //   blocks the worker based on the same-origin policy... Apparently a blob is
  //   not a safe origin. Google-Centric technology idiots.
  // Problem 2: We ourselves want to be a module for `import` working
  //   consistently in our stage 1 system.
  // Problem 3: Packing this package is the way we introduce all wasi_shim code
  //   into our sources.
  const module_src = await (await fetch(wasi_stage_url)).text();
  let idx = module_src.search('\nexport ');
  let modBlob = new Blob([module_src.slice(0, idx)], { type: 'text/javascript' });
  let moduleURL = URL.createObjectURL(modBlob);

  var worker = new Worker(moduleURL, { type: 'classic' });

  var worker_state = {
    elements: new Map(),
  };

  worker.onmessage = (event) => {
    /** Important note on event handling: The client references some data
     * through 'element-handles' which behave like file handles. However note
     * that the client is responsible for allocating this handles. For the sake
     * of reuse we must therefore synchronize the effects of element handle
     * re-assigments with the order of events such that it corresponds to the
     * client order. The rest of effects may be asynchronous.
     */
    if (event.data.error) {
      const {configuration, error} = event.data.error;
      fallback_shell(configuration, error)
    } else if (event.data['element-select']) {
      const {ed, selectors} = event.data['element-select'];

      var element = null;
      for (var selector of selectors) {
        if (selector['by-id']) {
          element = document.getElementById(selector['by-id']);
        } else if (selector['by-class-name']) {
          element = document.getElementsByClassName(selector['by-class-name']);
          if (!selector.multi) {
            element = element[0];
          }
        } else if (selector['by-tag-name']) {
          element = document.getElementsByTagName(selector['by-tag-name']);
          if (!selector.multi) {
            element = element[0];
          }
        }

        if (element !== null) {
          console.log('Matched ', selector, element);
          break;
        }
      }

      console.log('Opening element descriptor', ed, element);
      worker_state.elements.set(ed, element);
    } else if (event.data['element-exec']) {
      const {ed, fn, args, ret} = event.data['element-exec'];
      const fn_js = (new Function('return '+fn))();

      const element = worker_state.elements.get(ed);
      let result = fn_js(element, ...args);

      if (ret) {
        console.log('Invoked result', ret, result);
        worker.postMessage({ 'completed': { ed: ret, result: result } });
      }
    } else if (event.data['element-insert']) {
      const {ed, innerHTML} = event.data['element-insert'];
      console.log(ed, worker_state.elements.get(ed));
      worker_state.elements.get(ed).innerHTML = innerHTML;
    } else if (event.data['element-replace']) {
      const {ed, outerHTML} = event.data['element-replace'];
      worker_state.elements.get(ed).outerHTML = outerHTML;
      worker_state.elements.delete(ed);
    }
  };

  worker.postMessage({
    start: {
      wasi_root_fs: wasi_root_fs,
      wasm_body: wasmbody,
    }
  }, [wasmbody])

  console.log('Mounted and running async');
}

let worker_side_state = undefined;

onmessage = (event) => {
  console.log('worker received', event.data);
  if (event.data.start) {
    const { wasm_body, wasi_root_fs } = event.data.start;
    let channel = new MessageChannel();

    worker_side_state = {
      proxy_port: channel.port1,
    };

    channel.port1.onmessage = (event) => {
      const whatever = event.data;
      console.log('worker sending', whatever);
      self.postMessage(whatever, whatever.transfer || []);
    };

    worker_mount({
      wasm_body: wasm_body,
      wasi_root_fs: wasi_root_fs,
      port: channel.port2,
    })
  } else if (event.data.completed) {
    const {ed, result} = event.data.completed;
    worker_side_state.proxy_port.postMessage({ completed: { ed, result }});
  }
}

async function worker_mount({
  wasm_body,
  wasi_root_fs,
  port,
}) {
  const wasmblob = new Blob([wasm_body], { type: 'application/wasm' });
  const response = new Response(wasmblob);

  const [body_wasm, body_file] = response.body.tee();

  let wasm = await WebAssembly.compileStreaming(new Response(body_wasm, {
      'status': response.status,
      'statusText': response.statusText,
      'headers': response.headers,
    }));

  // Convert a body (compatible with `Response`) into an array buffer of its
  // contents by re-emulating an existing previous response reception.
  const body_to_array_buffer = async function(response, body_file) {
    const newbody = new Response(body_file, {
      'status': response.status,
      'statusText': response.statusText,
      'headers': response.headers,
    });

    return await newbody.arrayBuffer();
  };

  var configuration = {
    args: ["exe"],
    env: [],
    fds: [],
    wasm: await body_to_array_buffer(response, body_file),
    wasm_module: wasm,
  };

  let trigger_fallback = (configuration, error) => {
    port.postMessage({
      error: {
        configuration: {
          fds: [null, null, null, null],
        },
        error,
      }
    });
  };

  let wah_wasi_config_data = WebAssembly.Module.customSections(wasm, 'wah_wasi_config');
  wah_wasi_config_data.unshift(new TextEncoder('utf-8').encode('{}'));

  if (wah_wasi_config_data.length > 1) {
    // We can not handle this. Okay, granted, we could somehow put it into the
    // configuration object and let the script below handle it. It could be
    // said that I have not decided how to handle it. The section is ignored
    // anyways for now.
    throw `Multiple configuration sections 'wah_wasi_config' detected`;
  } else {
    const instr_debugging = console.log;
    /* Optional: we could pre-execute this on the config data, thus yielding
     * the `output` instructions.
     **/
    let raw_configuration = await load_config(wah_wasi_config_data[0]);

    let data = new Uint8Array(raw_configuration.buffer);
    let instruction_stream = new Uint32Array(raw_configuration.buffer);
    var iptr = 0;

    // The configuration output is 'script' in a simple, static assignment
    // scripting language. We have objects and each instruction calls one of
    // them with some arguments.
    //
    // Why are we having a script here, and not eval'ing Js? Well.. For once I
    // like have a rather small but configurable section. Js on the other hand
    // would be quite verbose. If in doubt, we have a `function` constructor as
    // an escape hatch?
    const ops = [
      /* 0: the configuration object */
      configuration,
      /* 1: skip */ 
      (cnt) => {
        instr_debugging(`skip ${cnt} to ${iptr+cnt}`);
        return iptr += cnt;
      },
      /* 2: string */
      (ptr, len) => {
        instr_debugging(`decode ${ptr} to ${ptr+len}`);
        return new TextDecoder('utf-8').decode(data.subarray(ptr, ptr+len));
      },
      /* 3: json */
      (ptr, len) => {
        instr_debugging(`json ${ptr} to ${ptr+len}`);
        return JSON.parse(data.subarray(ptr, ptr+len));
      },
      /* 4: integer const */
      (c) => {
        instr_debugging(`const ${c}`);
        return c;
      },
      /* 5: array */
      (ptr, len) => {
        instr_debugging(`array ${ptr} to ${ptr+len}`);
        return data.subarray(ptr, ptr+len);
      },
      /* 6: get */
      (from, idx) => {
        instr_debugging('get', from, ops[idx], (ops[from])[ops[idx]]);
        return (ops[from])[ops[idx]];
      },
      /* 7: set */
      (into, idx, what) => {
        instr_debugging('set', into, ops[idx], ops[what]);
        return (ops[into])[ops[idx]] = ops[what];
      },
      /* 8: File */
      (what) => {
        instr_debugging('file', ops[what]);
        return new File(ops[what]);
      },
      /* 9: Directory */
      (what) => {
        instr_debugging('directory', ops[what]);
        return new Directory(ops[what]);
      },
      /* 10: PreopenDirectory */
      (where, what) => {
        instr_debugging('preopen directory', ops[where], ops[what]);
        return new PreopenDirectory(ops[where], ops[what]);
      },
      /* 11: Directory.open */
      (dir, im_flags, path, im_oflags) => {
        instr_debugging('diropen', dir, im_flags, ops[path], im_oflags);
        return ops[dir].path_open(im_flags, ops[path], im_oflags).fd_obj;
      },
      /* 12: OpenFile */
      (what) => {
        instr_debugging('fileopen', ops[what]);
        return new OpenFile(ops[what]);
      },
      /* 13: section */ // FIXME: maybe pass the module itself explicitly?
      // Do we want to support compiling modules already at this point?
      (what) => {
        instr_debugging('wasm', ops[what]);
        return WebAssembly.Module.customSections(wasm, ops[what]);
      },
      /* 14: no-op */
      function() {
        instr_debugging('noop', arguments);
        return {};
      },
      /* 15: function */
      (what) => {
        instr_debugging('function', ops[what]);
        return new Function(ops[what]);
      },
    ];

    ops[255] = undefined;

    try {
      while (iptr < instruction_stream.length) {
        let fn_ = ops[instruction_stream.at(iptr)];
        let acnt = instruction_stream.at(iptr+1);
        let args = instruction_stream.subarray(iptr+2, iptr+2+acnt);

        ops.push(fn_.apply(null, args));
        iptr += 2 + acnt;
      }
    } catch (e) {
      console.log('Instructions failed', e);
      console.log(ops);
      trigger_fallback(configuration, e);
    }

    console.log(`Initialized towards stage3 in ${ops.length-256} steps`);
  }

  let args = configuration.args;
  let env = configuration.env;
  let fds = configuration.fds;
  let filesystem = configuration.fds[3];
  configuration.WASI = WASI;

  if (wasi_root_fs) {
    // The given layer will be underlaid the inputs to the boot archive extractor.
    for (const [key, value] of Object.entries(wasi_root_fs)) {
      let dirs = key.split('/');
      const file = dirs.pop();

      let basedir = filesystem;
      for (let dir of dirs) {
        // NOTE: should succeed with create_directory if we set OFLAGS_CREAT as
        // well but some versions of the shim handle this situation badly. So
        // do this in steps.
        let reldir = basedir.path_open(0, dir, WASI.OFLAGS_DIRECTORY);

        if (!reldir.fd_obj) {
          basedir.path_create_directory(dir);
          reldir = basedir.path_open(0, dir, WASI.OFLAGS_DIRECTORY);
        }

        if (!reldir.fd_obj) {
          console.log('Did not create..', key, dir, reldir, filesystem);
          break;
        }

        basedir = reldir.fd_obj;
      }

      // Open read-write with creation flags.
      const maybefd = basedir.path_open(0, file, 1, 1);

      // Error handling, supposing this signals ENOSUP just as well.
      if (!maybefd.fd_obj) {
        console.log('Did not write..', file, key, maybefd, basedir);
        continue;
      }

      const data_array = new Uint8Array(value);
      maybefd.fd_obj.file.data = data_array;
    }
  }

  configuration.wasi = new WASI(args, env, fds);
  const boot_exe = filesystem.path_open(0, "boot/init", 0).fd_obj;

  // FIXME: error handling?
  // If this is still something then let's replace.
  const primary_wasm = await WebAssembly.compileStreaming(new Response(
    new Blob([boot_exe.file.data.buffer], { type: 'application/javascript' }),
    { 'headers': response.headers }));

  let inst = await WebAssembly.instantiate(primary_wasm, {
    "wasi_snapshot_preview1": configuration.wasi.wasiImport,
  });

  const [stdin, stdout, stderr] = configuration.fds;

  try {
    try {
      configuration.wasi.start(inst);
    } catch (e) {
      trigger_fallback(configuration, e);
      return;
    }
  } finally {
    console.log('Result(stdin )', new TextDecoder().decode(stdin.file.data));
    console.log('Result(stdout)', new TextDecoder().decode(stdout.file.data));
    console.log('Result(stderr)', new TextDecoder().decode(stderr.file.data));
  }

  let module = filesystem.path_open(0, "boot/index.mjs", 0).fd_obj;

  if (module == null) {
    return trigger_fallback(configuration);
  }

  let blob = new Blob([module.file.data.buffer], { type: 'application/javascript' });
  let blobURL = URL.createObjectURL(blob);
  let stage3_module = (await import(blobURL));

  configuration.fallback_shell = trigger_fallback;
  configuration.port = port;
  console.log('executing boot module');

  try {
    await stage3_module.default(configuration);
  } catch (e) {
    trigger_fallback(configuration, e);
  }
}

export default mount;
