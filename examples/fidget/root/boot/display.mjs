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
  return Array.from(elements).map(el => {
    const uuid = uuidv4();
    el.id = uuid;
    return [uuid, el.innerText];
  });
}

async function replace_proc(proc, height, id) {
  const { stdout } = await proc.promise();

  if (stdout == null) {
    console.error('Process did not produce stdout');
    return;
  }

  let buffer = stdout.slice(0);
  replace_element_by_out(document.getElementById(id), height, buffer, id);
}

async function render(firmware, init) {
  const main_id = 'wasi-document-init';
  await replace_proc(init, '100%', main_id);

  const others = document.getElementsByClassName('fidget');

  for (var [elid, file] of synthesize_ids(others)) {
    const element = document.getElementById(elid);

    let dispatched = await firmware.createProcess({
      args: ['bin/fidget-cli.wasm', 'render3d', '--input', file, '-o', 'out.png', '--size', '256'],
      stdout: { file: 'out.png' },
    });

    console.log('Created process', dispatched.fid);
    await replace_proc(dispatched, '256px', elid);
  }

  let redo = document.getElementById(main_id);

  let dispatched = await firmware.createProcess({
    args: ['bin/fidget-cli.wasm', 'render3d', '--input', 'models/gyroid-sphere.rhai', '-o', 'out.png', '--size', '512'],
    stdout: { file: 'out.png' },
  });

  await replace_proc(dispatched, '100%', main_id);
  console.log('Redoing main document with higher resolution...');

  dispatched = await firmware.createProcess({
    args: ['bin/fidget-cli.wasm', 'render3d', '--input', 'models/gyroid-sphere.rhai', '-o', 'out.png', '--size', '1024'],
    stdout: { file: 'out.png' },
  });

  await replace_proc(dispatched, '100%', main_id);
  console.log('Redoing main document with higher resolution...');

  dispatched = await firmware.createProcess({
    args: ['bin/fidget-cli.wasm', 'render3d', '--input', 'models/gyroid-sphere.rhai', '-o', 'out.png', '--size', '2048'],
    stdout: { file: 'out.png' },
  });

  await replace_proc(dispatched, '100%', main_id);
  console.log('Redoing main document with higher resolution...');
}

function main(firmware) {
  // Run async. But extract references to the init process before.
  let init = firmware.init_proc(0);
  firmware.createFirmware(render(firmware, init));
}

export default main;
