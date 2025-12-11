async function display(proc) {
  const file = proc.configuration.fds[3]
    ?.path_open(0, 'ex.pdf', 0, 0);

  const out = file
    ?.fd_obj;

  console.log(proc.configuration.fds[3], file, out);

  if (out == undefined) {
    throw 'Oops, process crashed before success. No output to render';
  }

  let blob = new Blob([out.file.data.buffer], { type: 'application/pdf' });
  let blobURL = URL.createObjectURL(blob);
  proc.element.insert(`<object type="application/pdf" data=${blobURL} width=1920 height=920></object>`);
}

export default display;
