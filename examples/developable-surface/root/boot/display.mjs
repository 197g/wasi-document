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
    this.#next_frame.resolve({ value: ts });
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

async function main_loop(firmware) {
  const { files: [js, wasm] } = (
    await firmware.fsRead([
      'proc/display-obj/developable-surface.js',
      'proc/display-obj/developable-surface_bg.wasm',
    ]).promise()
  );

  console.log(js, wasm);

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

  let endless = Promise.withResolvers().promise;
  // Do not return.
  await endless;
}

export default function(firmware) {
  firmware.createFirmware(main_loop(firmware));
}
