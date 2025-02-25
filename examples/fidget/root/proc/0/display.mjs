function replace_element_by_out(element, height, buffer) {
  console.log(element, buffer);
  let blob = new Blob([buffer], { type: 'image/png' });

  let img = document.createElement('img');
  img.src = URL.createObjectURL(blob);
  img.style.height = height;

  element.outerHTML = img.outerHTML;
}

function synthesize_ids(elements) {
  // <https://stackoverflow.com/a/2117523>
  //
  // because of course localhost is not 'secure' in Chromium and thus we get no Crypto. WAT.
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

async function replace_proc(proc, height) {
  let buffer = proc.file_data('out.png').slice(0);
  await proc.exec(replace_element_by_out, [height, buffer], [buffer]);
}

async function display(proc) {
  replace_proc(proc, '100%');

  const others = proc.remote().select([
    { 'by-class-name': 'fidget', 'multi': true },
  ]);

  for (var [elid, file] of (await proc.remote().exec(others, synthesize_ids, [], []).promise)) {
    const element = proc.remote().select([
      { 'by-id': elid },
    ]);

    let dispatched = await proc.dispatch({
      executable: 'proc/0/exe',
      args: ['bin/fidget-cli.wasm', 'render3d', '--input', file, '-o', 'out.png', '--size', '256'],
      element: element,
    });

    replace_proc(dispatched, '256px');
  }
}

export default display;
