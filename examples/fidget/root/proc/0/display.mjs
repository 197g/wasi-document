function replace_element_by_out(element, height, buffer, id) {
  let blob = new Blob([buffer], { type: 'image/png' });

  let img = document.createElement('img');
  img.src = URL.createObjectURL(blob);
  img.style.height = height;

  if (id !== undefined) {
    img.id = id;
  }

  element.outerHTML = img.outerHTML;
}

// <https://stackoverflow.com/a/2117523>
//
// because of course localhost is not 'secure' in Chromium and thus we get no Crypto. WAT.
function uuidv4() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  );
}

function synthesize_ids(elements) {
  // Duplicated here since it must be part of the source text of
  // `synthesize_ids` which is evaluated in the global document context and not
  // this worker.
  function uuidv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
      (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
    );
  }

  return Array.from(elements).map(el => {
    const uuid = uuidv4();
    el.id = uuid;
    return [uuid, el.innerText];
  });
}

async function replace_proc(proc, height, id) {
  let buffer = proc.file_data('out.png').slice(0);
  await proc.exec(replace_element_by_out, [height, buffer, id], [buffer]);
}

async function display(proc) {
  const main_id = uuidv4();
  replace_proc(proc, '100%', main_id);

  const others = proc.remote().select([
    { 'by-class-name': 'fidget', 'multi': true },
  ]);

  for (var [elid, file] of (await proc.remote().exec(others, synthesize_ids, [], []).promise)) {
    const element = proc.remote().select([
      { 'by-id': elid },
    ]);

    let dispatched = await proc.dispatch({
      executable: 'bin/fidget-cli.wasm',
      args: ['bin/fidget-cli.wasm', 'render3d', '--input', file, '-o', 'out.png', '--size', '256'],
      element: element,
    });

    replace_proc(dispatched, '256px');
  }

  let redo = proc.remote().select([
    { 'by-id': main_id },
  ]);

  let dispatched = await proc.dispatch({
    executable: 'bin/fidget-cli.wasm',
    args: ['bin/fidget-cli.wasm', 'render3d', '--input', 'models/gyroid-sphere.rhai', '-o', 'out.png', '--size', '512'],
    element: redo,
  });

  replace_proc(dispatched, '100%', main_id);

  redo = proc.remote().select([
    { 'by-id': main_id },
  ])

  dispatched = await proc.dispatch({
    executable: 'bin/fidget-cli.wasm',
    args: ['bin/fidget-cli.wasm', 'render3d', '--input', 'models/gyroid-sphere.rhai', '-o', 'out.png', '--size', '1024'],
    element: redo,
  });

  replace_proc(dispatched, '100%', main_id);

  redo = proc.remote().select([
    { 'by-id': main_id },
  ])

  dispatched = await proc.dispatch({
    executable: 'bin/fidget-cli.wasm',
    args: ['bin/fidget-cli.wasm', 'render3d', '--input', 'models/gyroid-sphere.rhai', '-o', 'out.png', '--size', '2048'],
    element: redo,
  });

  replace_proc(dispatched, '100%', main_id);
}

export default display;
