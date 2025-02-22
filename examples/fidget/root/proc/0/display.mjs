async function display(proc) {
  let buffer = proc.file_data('out.png');
  let blob = new Blob([buffer], { type: 'image/png' });

  let img = document.createElement('img');
  img.src = URL.createObjectURL(blob);
  img.style.height = '100%';

  proc.replace(img.outerHTML);
}

export default display;
