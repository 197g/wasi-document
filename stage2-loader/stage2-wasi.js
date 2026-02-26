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

class Process {
  #promise;
  #reject;
  #resolve;

  constructor() {
    let p = Promise.withResolvers();
    this.#promise = p.promise;
    this.#reject = p.reject;
    this.#resolve = p.resolve;
  }

  promise() {
    return this.#promise;
  }

  reject(reason) {
    this.#reject(reason);
  }

  resolve(value) {
    this.#resolve(value);
  }
}

/** Stage 2 entry point: our goal here is to prepare an environment for the WASM 'kernel' to run.
 *
 * This means in particular we will create a worker and setup its module and a
 * communication channel between us and it. This serves two purposes: 1) it
 * allows us to run the kernel in a clean environment where it can more easily
 * control the extent of sandboxing 2) we move its event loop away from the
 * main page event loop, especially until we have async callbacks for Wasm
 * (JSPI).
 *
 * We present as a type of 'firmware' to the kernel. It was previously less
 * clear how to map the environment's capabilities to the implementation but if
 * we want to have an actual document then we must do something with a UI.
 * Clearly PDF and HTML present very different interactive capabilities and to
 * use them at all means to have a way of executing in the actual page context.
 * We don't want to build our own abstraction for this, that'd be stupidly
 * expensive and for what point? So rather we punt this to the user. Whatever
 * visualization you want but we give you the tools to separate WASI running in
 * a neatly controlled environment from WASI running in the main thread of the
 * page. This is achieved as firmware modules and kernel modules. The former
 * provide any capability you want, the latter allow you to create any hook you
 * want to access those capabilities.
 */
async function createSandbox({
  /* A Promise to a Response object that resolves to the WASM kernel module. */
  module_or_path,
  /* An array with the elements of the root FS as a tar-like structure */
  wasi_root_fs,
  /* An (Object) URL resolving to the stage 2 code itself */
  wasi_stage_url,
}) {
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
    reaper: new Map(),
    reaper_logging: new FinalizationRegistry((pid) => {
      console.warn(`Process ${pid} no longer reapable`);
    }),
    fid_counter: 65536,

    worker: worker,
    wasi_stage_url,
    commands: new Map(), 
    promises: [],

    runModuleFromBlob: async (blobURL, options, ed) => {
      try {
        let dispatch = (await import(blobURL, options?.import));
        let result = dispatch.default(worker_state, options);
        worker.postMessage({ 'completed': { ed: ed, result: result } });
        ed = undefined;
      } catch(e) {
        if (ed) {
          worker.postMessage({ 'completed': { ed: ed, error: ''+e } });
        }
      }
    },

    createFirmware: function(promise) {
      worker_state.reaper_logging.insert(promise, 'firmware');
      worker_state.promises.push(promise);
    },

    // Return a promise that resolves when the process with the given configuration is reaped.
    createProcess: function({ stdin, stdout, stderr, env, args }) {
      function mk_output(obj) {
        if (obj == undefined) {
          return { null: true };
        }

        if (Object.keys(obj).length != 1) {
          throw { error: { bad_io_binding: obj } };
        }

        if (obj.pipe) {
          const { pipe } = obj;
          return { pipe: !!pipe };
        } else if (obj.file) {
          const { file } = obj;
          return { file: ''+file };
        } else if (obj.null) {
          return { null: true };
        }

        throw { error: { unknown_io_binding: obj } };
      }

      function mk_input(obj) {
        if (obj == undefined) {
          return { null: true };
        }

        if (Object.keys(obj).length != 1) {
          throw { error: { bad_io_binding: obj } };
        }

        if (obj.file) {
          const { file } = obj;
          return { file: ''+file };
        } else if (obj.null) {
          return { null: true };
        }

        throw { error: { unknown_io_binding: obj } };
      }

      const fid = this.fid_counter;
      this.fid_counter += 1;
      let reaper = this._create_reaper(fid);

      worker.postMessage({
        'create-proc': {
          stdin: mk_input(stdin),
          stdout: mk_output(stdout),
          stderr: mk_output(stderr),
          env: env?.map(e => ''+e),
          args: args?.map(e => ''+e),
          fid,
        }
      });

      return reaper;
    },

    _create_reaper: function(fid) {
      const result = new Process();
      result.fid = fid;
      this.reaper.set(fid, (result));
      this.reaper_logging.register(result, fid); 
      // TODO: maybe we wrap this object? You must access `.promise` here.
      return result;
    },

    init_proc(id) {
      if (id > 65535) throw 'Not an init process';
      // Unlike other processes, since we did not spawn these ourselves there
      // may be no promise for them. FIXME: should the kernel tell us how many
      // there are as part of startup?
      let fallback = undefined;

      if (!this.reaper.has(id)) {
        fallback = new Process();
        this.reaper.set(id, (fallback));
        this.reaper_logging.register(fallback, id); 
      }

      return this.reaper.get(id);
    }
  };

  worker.onmessage = (event) => {
    let data = event.data;
    let transfer = data.transfer || [];
    delete data.transfer;

    if (Object.keys(data).length != 1) {
      data = { error: { invalid_message: event } }
    }

    const [command, value] = Object.entries(data)[0];
    const handler = worker_state.commands.get(command);
    if (handler) handler(value, worker_state, { event: event });
    else console.warn('Unknown command from kernel', command, value);
  };


  /** Important note on event handling: The client references some data
   * through 'element-handles' which behave like file handles. However note
   * that the client is responsible for allocating this handles. For the sake
   * of reuse we must therefore synchronize the effects of element handle
   * re-assigments with the order of events such that it corresponds to the
   * client order. The rest of effects may be asynchronous.
   */
  worker_state.commands.set("error", data => {
    console.log('Kernel error',  data);
    const { configuration, error } = data;
    fallback_shell(configuration, error)
  });

  worker_state.commands.set("module", data => {
    // Kernel sending us modules to run in 'firmware'.
    const { module, type, options, ed } = data;
    let blob = new Blob([module], { type: 'application/javascript' });
    let blobURL = URL.createObjectURL(blob);
    worker_state.runModuleFromBlob(blobURL, options, ed);
  });

  worker_state.commands.set("reap", data => {
    // Kernel telling us a root process ended.
    const { stdout, stderr, status, pid, fid } = data;
    const reaper = worker_state.reaper.get(fid);

    if (reaper == undefined) {
      console.warn(`Process ${pid} reaped with no reaper`, data);
      return;
    }

    worker_state.reaper.delete(fid);
    let pobj = reaper;

    if (pobj == undefined) {
      console.warn(`Process ${pid} reaped with no one waiting`, data);
      return;
    }

    pobj?.resolve({ stdout, stderr, status, pid, fid });
  });

  worker_state.commands.set("element-select", data => {
      const {ed, selectors} = data;

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
  });

  worker_state.commands.set("element-exec", data => {
    const {ed, fn, args, ret} = event.data['element-exec'];
    const fn_js = (new Function('return '+fn))();

    const element = worker_state.elements.get(ed);
    let result = fn_js(element, ...args);

    if (ret) {
      console.log('Invoked result', ret, result);
      worker.postMessage({ 'completed': { ed: ret, result: result } });
    }
  });

  worker_state.commands.set("element-insert", data => {
    const {ed, innerHTML} = data;
    console.log(ed, worker_state.elements.get(ed));
    worker_state.elements.get(ed).innerHTML = innerHTML;
  });

  worker_state.commands.set("element-replace", data => {
    const {ed, outerHTML} = data;
    worker_state.elements.get(ed).outerHTML = outerHTML;
    worker_state.elements.delete(ed);
  });

  // Remove any DOM element references from the file objects, we don't want to send
  wasi_root_fs = wasi_root_fs.map(({header, data}) => {
    return {header: header, data: data}
  });

  worker.postMessage({
    start: {
      wasi_root_fs: wasi_root_fs,
      wasm_body: wasmbody,
    }
  }, [wasmbody])

  console.log('Mounted and running async');

  initialize_firmware(worker_state);

  while (worker_state.promises.length > 0) {
    let worker_promises = worker_state.promises.splice(0, Infinity);

    if (worker_promises.length == 0) {
      break;
    }

    await Promise.allSettled(worker_promises);
  }

  console.log('All firmware processes completed, shutdown?');
}

/** Our instructions come from the page.
 *
 * We parse meta elements based on their itemprop (and related value by `content` attribute).
 */
async function initialize_firmware(worker_state) {
  let headElement = document.getElementsByTagName('head');

  if (headElement.length == 0) {
    return;
  }

  let metas = Array.from(headElement[0]?.querySelectorAll(':scope>meta[itemprop="wasi-document"]'));
  let declarative = metas.find(el => el.content == 'init-declarative');

  if (declarative) {
    // We run in declarative mode, observing and running the wasi-document
    // custom elements, while this element is present. They observe themselves
    // via the lifecycle hooks but we observe the meta element to know when it
    // is removed and thus when to stop observing.
    let stop_at = Promise.withResolvers();

    let observer = new MutationObserver((mutations) => {
      for (let mutation of mutations) {
        let removed = Array.from(mutation.removedNodes || []);

        if (removed.indexOf(declarative) >= 0) {
          console.trace('Stopping observation of declarative wasi-document elements');
          observer.disconnect();
          stop_at.resolve(observer);
        }
      }
    });

    console.trace('Running in declarative mode, observing meta element for stop');
    observer.observe(headElement[0], { childList: true, subtree: false });
    worker_state.promises.push(stop_at.promise);
  }

  if (metas.find(el => el.content == 'wasi-document-output')) {
    let templates = Array.from(document.getElementsByClassName('wasi-document-process'))
      .filter(el => el.tagName == 'TEMPLATE');

    let template_map = templates.reduce((acc, el) => {
      let key = el.getAttribute('data-process');
      acc.set(key, el);
      return acc;
    }, new Map());

    class WasiDocumentRender extends HTMLElement {
      constructor() {
        super();
      }
    }

    // Note we define it here. Global scope is also read by the worker. This
    // makes the module self-contained but really it isn't very nice. Also this
    // way we can refer to the actual worker state. Maybe it is nice.
    class WasiDocumentElement extends HTMLElement {
      static worker_state = worker_state;
      static template_map = template_map;
      static observedAttributes = ['data-wasi-process'];

      constructor() {
        super();
        this.proc_id = this.getAttribute('data-wasi-process');
      }

      connectedCallback() {
        let process_template = this.constructor.template_map.get(this.proc_id);
        console.log('Running process from template', process_template);
        let promise = this.#instantiate(process_template);
      }

      #instantiate(template) {
        const template_node = this.ownerDocument.importNode(template.content, true);

        // We 'render' the thing into a new template node. The point here is
        // that our own element, which is a temporary for rendering, is not
        // getting modified with the process template before we have the actual
        // output. The node must be in the document though..
        const rendered = this.parentElement.appendChild(this.ownerDocument.createElement('wasi-document-render'));

        let contents = new DocumentFragment();
        contents.replaceChildren(...this.cloneNode(true).children);
        rendered.append(contents);
        // rendered.hidden = true;

        const shadowRoot = rendered.attachShadow({ mode: "open", slotAssignment: "named" });
        shadowRoot.appendChild(template_node);

        // FIXME: if you think we should do slots ourselves to force it to
        // happen in the same tick, be my guest. I think that's a bad idea and
        // let's just acquire the element after..
        if (shadowRoot.querySelector('slot')) {
          console.trace('slots, so we render on event');
          shadowRoot.addEventListener('slotchange', this.#ondefinitionready.bind(this, rendered), { once: false });
        } else {
          console.trace('no slots, we render now');
          this.#ondefinitionready(rendered);
        }
      }

      #ondefinitionready(rendered) {
        let create_process = this.#build_create_process(rendered.shadowRoot);
      }

      #build_create_process(root) {
        // Build the props, including those elements from the light DOM.

        // FIXME: While we are currently in a slotchange event, we could cache
        // unchanged slot trees. Then again this is not supposed to change;
        // just be called once.
        let assignees = [...root.querySelectorAll('slot')]
          .flatMap(slot => slot.assignedElements({ flatten: true }));

        // Note that querySelectorAll only selects descendants. So we handle
        // the newly discovered roots separately by our own.
        let recursive = assignees.flatMap(el => [...el.querySelectorAll(':scope [itemprop]')]);

        let props = [
          ...root.querySelectorAll('[itemprop]'),
          ...assignees.filter(el => el.hasAttribute('itemprop')),
          ...recursive,
        ];

        let args = props.filter(el => el.getAttribute('itemprop') == 'args');
        let env = props.filter(el => el.getAttribute('itemprop') == 'env');
        let fds = props.filter(el => el.getAttribute('itemprop') == 'fd');

        let stdin = fds.find(el => el.getAttribute('data-fd') == '0');
        let stdout = fds.find(el => el.getAttribute('data-fd') == '1');
        let stderr = fds.find(el => el.getAttribute('data-fd') == '2');

        const io_element = (el) => {
          if ((el || null) == null) return { null: true };
          else if (el.tagName == 'A') return { file: el.href };
          // FIXME: initial content from text content.
          else return { pipe: true };
        };

        return {
          args: args.map(el => el.textContent),
          env: env.map(el => el.textContent),
          stdin: io_element(stdin),
          stdout: io_element(stdout),
          stderr: io_element(stderr),
        }
      }
    }

    customElements.define('wasi-document-render', WasiDocumentRender);
    customElements.define('wasi-document-output', WasiDocumentElement);
  }
}

/***
 * Worker side, running initially in the WebWorker to provide the basic
 * communication to the kernel and bootstrap it.
 *
 * FIXME: sometimes we may want the kernel (the basic Wasm module) to run
 * directly in the browser and for it to be mounted with wasm-bindgen bindings.
 * That is it should be pointless to provide a 'kernel' if we only send some
 * data back to the browser and need the filesystem anyways.. (also that lets
 * us avoid JSPI by speaking wasip1 across the worker socket).
 */

let worker_side_state = undefined;

/* Part of the interface of spawning this module as a worker.
 */
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
      console.log('worker sent', whatever);
      self.postMessage(whatever, whatever.transfer || []);
    };

    worker_mount({
      wasm_body: wasm_body,
      wasi_root_fs: wasi_root_fs,
      port: channel.port2,
    })
  } else if (event.data.completed) {
    const {ed, result, error, transfer} = event.data.completed;
    worker_side_state.proxy_port.postMessage({ completed: { ed, result, error, transfer }}, transfer);
  } else {
    console.warn('worker received message may not be proxied correctly to kernel', event.data);
    worker_side_state.proxy_port.postMessage(event.data, event.data.transfer);
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
    let wasi_root_files = new Map(wasi_root_fs.map(item => [item.header.name, item.data]));

    // The given layer will be underlaid the inputs to the boot archive extractor.
    for (const [key, value] of wasi_root_files) {
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

  let module = filesystem.path_open(0, "init.mjs", 0).fd_obj;

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

  console.log('done with boot module');
}

export default createSandbox;
