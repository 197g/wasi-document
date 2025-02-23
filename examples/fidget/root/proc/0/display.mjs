function replace_element_by_out(proc, height) {
  let buffer = proc.file_data('out.png');
  let blob = new Blob([buffer], { type: 'image/png' });

  let img = document.createElement('img');
  img.src = URL.createObjectURL(blob);
  img.style.height = height;

  proc.replace(img.outerHTML);
}

async function display(proc) {
  replace_element_by_out(proc, '100%');

  for (var el of Array.from(document.getElementsByClassName('fidget'))) {
    let file = el.innerText;
    console.log('Now rendering', file, 'into', el);

    let dispatched = await proc.dispatch({
      executable: 'proc/0/exe',
      args: ['bin/fidget-cli.wasm', 'render3d', '--input', file, '-o', 'out.png', '--size', '256'],
      element: el,
    });

    replace_element_by_out(dispatched, '256px');
  }
}

export default display;
