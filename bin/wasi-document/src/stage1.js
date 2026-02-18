async function init(bytes, boot_wasm, wasi_root_fs) {
  let index_html = WebAssembly.Module.customSections(boot_wasm, 'wah_polyglot_stage1_html');

  if (index_html.length) {
    document.documentElement.innerHTML = (new TextDecoder().decode(index_html[0]));
  } else {
    const error = document.getElementById('stage0_error');
    if (error) {
      error.innerText = '';
    }
  }

  let stage2 = WebAssembly.Module.customSections(boot_wasm, 'wah_polyglot_stage2');
  if (!stage2.length) {
    throw 'Found no application data. Please check distribution.';
  }
  if (!stage2.length > 1) {
    throw 'Found duplicate application data. Please check distribution.';
  }

  /* This is the wasm-bindgen flavor.
       It is one module with an default export (`init`). The exported
       function can take a Promise to a Response object that resolves to the WASM module.
       Since we have it already we just create a synthetic response.
   **/
  let blob = new Blob([stage2[0]], { type: 'text/javascript' });
  let blobURL = URL.createObjectURL(blob);
  let stage2_module = (await import(blobURL));

  let delayed_file_promises = [];
  for (const item of wasi_root_fs) {
    if (item.header.typeflag == 'S') {
      // 'Symlink' aka. an external resource.
      delayed_file_promises.push(async () => {
        const response = await fetch(item.header.linkname);
        const data = await respose.toArrayBuffer();

        // Turn this into a Base64 string, we modify the DOM for completeness.
        const reader = new FileReader();
        reader.readAsDataURL(new Blob([data]));
        const data_url_data = reader.result.replace(/^data:.*;base64,/, '');

        el.textContent = data_url_data;
      })
    }
  }

  await Promise.all(delayed_file_promises);

  let wasmblob = new Blob([bytes], { type: 'application/wasm' });
  stage2_module.default({
    module_or_path: Promise.resolve(new Response(wasmblob)),
    wasi_root_fs: wasi_root_fs,
    wasi_stage_url: blobURL,
  });
}

export default init;
