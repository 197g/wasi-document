/** A worker that lets us add Cross-Origin-Embedder-Policy and Cross-origin-Opener-Policy to another resource
 *
 * For certain 'secure' features (meaning: may leak your details to other sites
 * via a side-channel you do not control), the browser requires that the page
 * is cross-origin 'isolated'. There is no meta-http-equiv tag for this and
 * even if it were we may not want to require it. `file://`-URLs despite _not
 * being embeddable_ are *not* considered isolated. That is stupid. But in case
 * you meant to serve this page from a server may it is for the best. We in
 * particular want to use SharedArrayBuffers in the WASI context, meaning in
 * the kernel for various reasons. Chief among them, implementing virtio io
 * devices so that the only specialized IO needed is a generic 'interrupt'
 * bus—and an interrupt-wait host function as a JSPI call if emulating the
 * RISC-V wfi or equivalent).
 */

onmessage = async (event) => {
  self.postMessage('Hello from the worker!');
}

self.addEventListener("fetch",  (event) => {
  console.log('Worker fetch event:', event);
});
