// Entry-Point called after the kernel boots (sets up the file system etc).
class RenderPacer {
  #next_frame;
  #done_promise;

  constructor() {
    this.#next_frame = null;
  }

  pacer_launch() {
    if (!this.#next_frame) {
      this.#next_frame = Promise.withResolvers();
    }

    requestAnimationFrame((ts) => {
      this._on_animationFrame(ts);
    });
  }

  pacer_stop() {
    if (this.#next_frame) {
      this.#next_frame.resolve({ done: true });
    }

    this.#next_frame = null;
  }

  _on_animationFrame(ts) {
    // The Stream abstraction used with bindgen works on JsValue.
    this.#next_frame.resolve({ value: new Number(ts) });
    this.#next_frame = Promise.withResolvers();

    requestAnimationFrame((ts) => {
      this._on_animationFrame(ts);
    });
  }

  // This is also an async Iterator (not AsyncIterable).
  next() {
    if (this.#next_frame) {
      return this.#next_frame.promise;
    } else {
      return this._done_promise();
    }
  }

  _done_promise() {
    if (!this.#done_promise) {
      this.#done_promise = Promise.withResolvers();
      this.#done_promise.resolve({ done: true });
    }

    return this.#done_promise.promise;
  }
}

/** An AsyncIterator with the semantics:
 * - Constant memory use, there is no queue.
 * - If you push an item, the stream will resolve to this or a more recent value.
 *
 * This allows us to fetch an item (a state) from the stream, work on it
 * asynchronously, with the guarantee that in quiescent periods we always
 * *eventually* have worked on the latest state; but compared to event source,
 * when completion rate is slower than creation rate we do not pile up an
 * infinite latency of backlog.
 *
 * A more advanced version of this would have a 'merge' function that can
 * resolve the conflict of pushing quicker than items are consumed. Instead of
 * throwing old state away we may be able to merge it into the most recent item
 * to preserve its effect. This allows policy to create a bounded queue.
 */
class StateSourceStream {
  #state;
  #unresolved;
  #merge;

  constructor(merge) {
    this.#state = undefined;
    this.#unresolved = undefined;
    this.#merge = merge || ((oldv, newv) => newv);
  }

  push(newvalue) {
    this.#state = this.#merge(this.#state, newvalue);
    if (this.#unresolved) {
      // Will delete the attribute in the next microtick.
      this.#unresolved.resolve({ value: newvalue} );
      this.#unresolved = undefined;
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    if (this.#unresolved) {
      return this.#unresolved.promise;
    }

    if (this.#state) {
      const immediately = Promise.withResolvers();
      immediately.resolve({ value: this.#state });
      this.#state = undefined;
      return immediately.promise;
    }

    this.#unresolved = Promise.withResolvers();
    return this.#unresolved.promise;
  }
}

function link_stylesheet(style) {
  let style_blob = new Blob([style], { type: 'text/css' });
  let link = document.createElement('link');
  link.href = URL.createObjectURL(style_blob)
  link.rel = 'stylesheet';
  document.head.appendChild(link);
}

function install_controls(control_data) {
  const form = document.getElementById('ctrl');
  const { stream } = control_data;

  const input_number = document.getElementById('enter-loc');
  const all_parameters = document.getElementById('ctrl').firstElementChild;
  const free_parameters = document.getElementById('free-parameter-list');

  const enter_parameter = document.getElementById('enter-p');
  const exit_parameter = document.getElementById('exit-p');

  const btn_download = document.getElementById('download');
  const btn_store = document.getElementById('store');
  const btn_load = document.getElementById('load');

  const extras = [
    { loc: 0.5, h: 0.2 },
    { loc: 1.5, h: 0.0 },
    { loc: 2.5, h: -0.16 },
    { loc: 3.5, h: 0.0 },
  ];
  
  for (const { loc, h } of extras) {
    let in_loc = input_number.cloneNode(true);
    in_loc.disabled = false;
    in_loc.value = loc;
    // List is read-only and has no interface I know of. so really we must do
    // this by cloning something from the Dom and a template is overkill here
    // (for now).
    let in_h = enter_parameter.cloneNode(true);
    in_h.value = h;

    free_parameters.appendChild(in_loc);
    free_parameters.appendChild(in_h);
  }

  const angle_to_rad = (angle) => angle / 180 * 3.14159265;

  const load_parameter = () => {
  };

  const store_parameter = () => {
  };

  const submit_parameter = () => {
    let free_locs = free_parameters.querySelectorAll(':scope input[type=number]');
    let free_vals = free_parameters.querySelectorAll(':scope input[type=range]');

    let locs = Array.from(free_locs).map((e) => parseFloat(e.value));
    let parameters = Array.from(free_vals).map((e, i) => {
      return {
        loc: locs[i],
        h: angle_to_rad(e.value),
      };
    });
    
    parameters.sort((lhs, rhs) => lhs.loc - rhs.loc);
    parameters.unshift({ 'loc': 0, h: angle_to_rad(enter_parameter.value) });
    parameters.push({ 'loc': 3.99, h: angle_to_rad(exit_parameter.value) });

    console.log(parameters);

    const complex = {
      'hermite': [
        {
          position: [0.0, 0.0, 0.0],
          tangent: [1.0, 0.0, 0.0],
        },
        {
          position: [1.0, 1.0, 0.2],
          tangent: [0.0, 1.0, 0.0],
        },
        {
          position: [0.0, 2.0, 0.2],
          tangent: [-1.0, 0.1, 0.0],
        },
        {
          position: [-1.0, 2.0, 0.0],
          tangent: [-1.0, 0.0, 0.0],
        }
      ],
      'normal': [ 0.0, -0.3, 1.0 ],
    };

    const simpler = {
      'hermite': [
        {
          position: [1.0, 0.0, 0.0],
          tangent: [0.0, 1.0, 0.0],
        },
        {
          position: [0.0, 1.0, 0.0],
          tangent: [-1.0, 0.0, 0.0],
        },
        {
          position: [-1.0, 0.0, 0.0],
          tangent: [0.0, -1.0, 0.0],
        },
        {
          position: [0.0, -1.0, 0.0],
          tangent: [1.0, 0.0, 0.0],
        },
        {
          position: [1.0, 0.0, 0.0],
          tangent: [0.0, 1.0, 0.0],
        },
      ],
      'normal': [0.99, 0.0, 0.1],
    };

    const spiral = {
      'hermite': [],
      'nodes': [
        {'hermite': [
          {
            position: [1.0, 0.0, 0.0],
            tangent: [0.0, 1.0, 0.0],
          },
          {
            position: [0.0, 1.0, 0.0],
            tangent: [-1.0, 0.0, 0.0],
          },
          {
            position: [-1.0, 0.0, 0.0],
            tangent: [0.0, -1.0, 0.0],
          },
          {
            position: [0.0, -1.0, 0.0],
            tangent: [1.0, 0.0, 0.0],
          },
          {
            position: [1.0, 0.0, 0.0],
            tangent: [0.0, 1.0, 0.0],
          },
        ]},
        {'spiral': {
          radius: 2.0,
          pitch: 3.0,
        }},
        {'hermite': [
          {
            position: [1.0, 0.0, 0.0],
            tangent: [0.0, 1.0, 0.0],
          },
          {
            position: [0.0, 1.0, 0.0],
            tangent: [-1.0, 0.0, 0.0],
          },
          {
            position: [-1.0, 0.0, 0.0],
            tangent: [0.0, -1.0, 0.0],
          },
        ]},
      ],
      'normal': [1.0, 0.0, 0.0],
    };

    stream.push({
      parameter: parameters,
      ... spiral,
    });
  }

  form.onsubmit = submit_parameter;

  enter_parameter.onchange = submit_parameter;
  exit_parameter.onchange = submit_parameter;

  for (const inp of free_parameters.querySelectorAll(':scope input[type=range]')) {
    inp.onchange = submit_parameter;
  }

  btn_download.onclick = (ev) => {
    const { obj, svg } = control_data.data;
    const url_obj = URL.createObjectURL(new Blob([obj], { 'content-type': 'text/ascii' }));
    const url_svg = URL.createObjectURL(new Blob([svg], { 'content-type': 'image/svg+xml' }));

    const link = document.createElement('a');
    link.href = url_obj;
    link.download = 'example.obj';

    btn_download.after(link);
    link.click();

    link.href = url_svg;
    link.download = 'example.svg';

    link.click();
    btn_download.parent.removeChild(link);
  };

  // Next microtick, i.e. after the above dom changes have propagated, for consistency.
  (async function() {
    submit_parameter()
  })();
}

async function install_worker(control_data, firmware) {
  let { renderer, stream } = control_data;
  let show_svg = document.getElementById('show-svg');

  let l = new TextEncoder();
  let d = new TextDecoder();

  for await (const value of stream) {
    const input_date = l.encode(JSON.stringify(value));

    let dispatched = await firmware.createProcess({
      args: ['bin/dc-plot.wasm'],
      stdin: { pipe: input_date.buffer },
      stdout: { pipe: true },
      stderr: { pipe: true },
    });

    const { stdout, stderr } = await dispatched.promise();
    const json_str = d.decode(stdout);
    console.info(stdout, json_str);
    console.info(stderr, d.decode(stderr));

    try {
      const { obj, svg } = JSON.parse(json_str);

      renderer.set_obj(obj);
      show_svg.innerHTML = svg;
      control_data.data = { obj, svg };
    } catch (e) {}
  }
}

async function main_loop(firmware) {
  const { files: [js, wasm, style] } = (
    await firmware.fsRead([
      'proc/display-obj/developable-surface.js',
      'proc/display-obj/developable-surface_bg.wasm',
      'style.css'
    ]).promise()
  );

  console.log(js, wasm);
  link_stylesheet(style);

  let wasm_blob = new Blob([wasm], { type: 'application/wasm' });

  let js_blob = new Blob([js], { type: 'text/javascript' });
  let js_url = URL.createObjectURL(js_blob);
  const js_module = await import(js_url);
  URL.revokeObjectURL(js_url);

  const canvas = document.getElementById('canvas-name');
  const instance = await js_module.default(new Response(wasm_blob));
  console.log('Render instantiated');

  let pacer = new RenderPacer();
  const renderer = js_module.create_renderer(pacer);

  console.log('Render initialized');
  pacer.pacer_launch();

  const canvas_size = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { blockSize, inlineSize } = entry.contentBoxSize[0];
      renderer.set_size(blockSize, inlineSize);
      canvas.width = blockSize;
      canvas.height = inlineSize;
      break;
    }
  });

  canvas_size.observe(canvas);

  const { files: [svg, obj] } = (
    await firmware.fsRead([
      'template-neat.svg',
      'template-neat.obj',
    ]).promise()
  );

  let l = new TextDecoder();
  const obj_text = l.decode(obj);
  renderer.set_obj(obj_text);

  l = new TextDecoder();
  const svg_text = l.decode(svg);
  document.getElementById('show-svg').innerHTML = svg_text;

  const control_data = {
    renderer: renderer,
    stream: new StateSourceStream(),
    data: { obj: obj_text, svg: svg_text },
  };

  install_worker(control_data, firmware);
  install_controls(control_data);

  let endless = Promise.withResolvers().promise;
  // Do not return.
  await endless;
}

export default function(firmware) {
  firmware.createFirmware(main_loop(firmware));
}
