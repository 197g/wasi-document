async function init(bytes, wasm, initial) {
  let index_html = WebAssembly.Module.customSections(wasm, 'wah_polyglot_stage1_html');

  if (index_html.length) {
    document.documentElement.innerHTML = (new TextDecoder().decode(index_html[0]));
  } else {
    document.getElementById('stage0_error').innerText = '';
  }

  let stage2 = WebAssembly.Module.customSections(wasm, 'wah_polyglot_stage2');
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
  let blob = new Blob([stage2[0]], { type: 'application/javascript' });
  let blobURL = URL.createObjectURL(blob);
  let stage2_module = (await import(blobURL));

  /** wasm-bindgen: creates one 
  */
  function with_bytes(bytes) {
    let wasmblob = new Blob([bytes], { type: 'application/wasm' });
    stage2_module.default(Promise.resolve(new Response(wasmblob)));
  }

  with_bytes(bytes);
  refetch(bytes, with_bytes, 1000);
}

async function refetch(bytes, onchange, interval) {
  async function identify(data) {
    let hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  let curHash = await identify(bytes);

  setInterval(async function() {
    let doc = await fetch(window.location.href);
    let bytes = await doc.arrayBuffer();
    let newHash = await identify(bytes);

    if (newHash == curHash) {
      return;
    }

    console.log('Tiggering reload', newHash, curHash, bytes);
    curHash = newHash;
    onchange(bytes);
  }, interval || 30);
}

export default init;
