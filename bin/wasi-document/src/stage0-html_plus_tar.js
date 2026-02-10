/** An entry/on-load script to 'boots' a browser Javascript environment into
 * the packed bootstrapping format defined by the wasm-as-html project. We
 * expect to be started in an HTML page that was prepared with the `html+tar`
 * polyglot structure. That is there should be a number of `<template>`
 * elements which escape tar headers and contents so as not to be interpreted
 * by the HTML structure. Our task is to gather them up, undo the encoding used
 * to hide them here and make the resulting file tree available for further
 * processing. Then we inspect that tree for a special boot file that defines a
 * stage-1 payload WASM whose definition are shared with other stage-0 encoding
 * entry points and whose contents we interpret accordingly to further dispatch
 * into our bootstrap process. (The stage-1 then sets up for executing a
 * WebAssembly module, which will regularize the environment to execute the
 * original module).
 *
 * The code here is quite self-contained with the main piece being an inlined
 * base64 decoder that is actually _correct_ for all inputs we throw at it.
 */

// State object, introspectable for now.
let __wah_stage0_global = {};
const BOOT = 'boot/wah-init.wasm';

function b64_decode(b64, options={}) {
  // Effectively a static, since calls share the default argument object.
  if (options.tr === undefined) {
    const IDX_STR = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
    options.tr = new Uint8Array(256);

    // Note `=` translates to 0o100
    for (let i = 0; i <= 64; i++) {
      options.tr[IDX_STR.charCodeAt(i)] = i;
    }
  }

  // Performance note: `/=*$/` is actually awfully slow (trace has some 164ms! for 256kb). So we only use it if we have to.
  let mk_buffer = undefined;
  // Overfull padding?
  if (b64.charAt(b64.length - 3) === '=') {
    mk_buffer = (b64.length / 4) * 3 - b64.match(/=*$/)[0].length;
  } else {
    mk_buffer = (b64.length / 4) * 3 - (b64.charAt(b64.length - 2) === '=' ? 2 : b64.charAt(b64.length - 1) == '=' ? 1 : 0);

  }

  const buffer = new ArrayBuffer(mk_buffer);
  const view = new Uint8Array(buffer);
  const tr = options.tr;

  let i = 0;
  let j = 0;
  for (; j < b64.length;) {
    let a = tr[b64.charCodeAt(j++)] || 0;
    let b = tr[b64.charCodeAt(j++)] || 0;
    let c = tr[b64.charCodeAt(j++)] || 0;
    let d = tr[b64.charCodeAt(j++)] || 0;

    view[i++] = (a << 2) | (b >> 4);
    if (c < 64) view[i++] = ((b & 0xf) << 4) | (c >> 2);
    if (d < 64) view[i++] = ((c & 0x3) << 6) | (d >> 0);
  }

  return view;
}

window.addEventListener('load', async function() {
  console.debug('Wasm-As-HTML bootstrapping stage-0: started');
  const dataElements = document.getElementsByClassName('wah_polyglot_data');

  let global = __wah_stage0_global;
  global.file_objects = [];
  global.file_data = {};

  for (let el of dataElements) {
    const givenName = el.getAttribute('data-wahtml_id')
      ?.replaceAll(String.fromCodePoint(0xfffd), '')
      ?.replaceAll(String.fromCodePoint(0), '');

    if (givenName === null) {
      continue;
    }

    // NOTE: An observation from a previous <template> approach: usually we
    // `firstChild.textContent`. But for reasons unknown to me at the moment of
    // writing this truncates the resulting string to a clean 1<<16 bytes
    // instead of retaining the full encoding; in Chromium browsers but not in
    // Firefox.
    // NOTE: now being more knowledgable, it's probably that the content
    // already is a pure text node. So its first child attribute is probably
    // synthetic and there's some encoding roundtrip which mangles it. Eh. This
    // is fine if it works and we do control the encoding side as well.

    // Note: A replace /[..]*$/ is slow. We know that there is at most 512
    // padding inserted behind it and then we will find the end element. To be
    // safe, consider another header and do a replace on a constant maximum
    // length of at most 1 << 12 characters. (That is, in case this is the last
    // file before an EOF we will find two consecutive zeroed headers before
    // the closing tag, plus alignment. Just round that up to 4 blocks).
    let b64content = el.textContent.replace(/^[^0-9a-zA-Z+\/]*/, "");
    let trimBack = b64content.slice(-2048, b64content.length).replace(/^[0-9a-zA-Z+\/=]*/, "").length;
    b64content = b64content.slice(0, -trimBack);
    const raw_content = b64_decode(b64content);
    global.file_data[givenName] = raw_content;

    // The `TarHeader` contents except for the name (first field), so at an
    // offset 100 bytes into the header. Note: offsets are dependent on the
    // browser encoding but since the whole header is encoded as ASCII this is
    // reasonably exactly one byte per char, i.e. in both UTF-8 and UTF-16 the
    // offsets are the same.
    const file_header = el.getAttribute('data-b');

    if (b64content.length != parseInt(file_header.slice(24, 36), 8)) {
      console.log(givenName, el);
      throw 'Bad file';
    }

    // Note we do not attach the DOM element here. We want a clean, pure memory
    // representation of the file system tree here. (That we can send to a
    // worker).
    global.file_objects.push({
      header: {
        all: file_header,
        name: givenName,
        mode: file_header?.slice(0, 8) || '',
        uid: file_header ? parseInt(file_header.slice(8, 16), 8) : 0,
        gid: file_header ? parseInt(file_header.slice(16, 24), 8) : 0,
        size: file_header ? parseInt(file_header.slice(24, 36), 8) : 0,
        mtime: file_header ? parseInt(file_header.slice(36, 48), 8) : 0,
        typeflag: file_header?.charCodeAt(56) || 0,
        uname: file_header ? file_header.slice(165, 197).replace(/\0.*$/, '') : '',
        gname: file_header ? file_header.slice(197, 229).replace(/\0.*$/, '') : '',
      },
      data: raw_content,
    });
  }

  const boot_wasm_bytes = global.file_data[BOOT];

  if (boot_wasm_bytes === undefined) {
    console.debug('Wasm-As-HTML bootstrapping stage-0: no handoff to boot, done');
    return;
  }

  let wasm = await WebAssembly.compileStreaming(
    new Response(boot_wasm_bytes, { headers: { 'content-type': 'application/wasm' }})
  );

  try {
    let stage1 = WebAssembly.Module.customSections(wasm, 'wah_polyglot_stage1')[0];
    let blob = new Blob([stage1], { type: 'application/javascript' });
    let blobURL = URL.createObjectURL(blob);
    let module = (await import(blobURL));
    console.debug('Wasm-As-HTML bootstrapping stage-0: handoff');
    await module.default(boot_wasm_bytes, wasm, global.file_objects);
  } catch (e) {
    console.error('Wasm-As-HTML failed to initialized', global, e);
  }
});
