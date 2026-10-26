import * as THREE from 'three';

// Images are decoded, and flipped the way WebGL wants them, off the main thread while they download.
// With a plain TextureLoader the browser does both on the main thread during the first upload, which
// took ~7 s at startup for the 8k planet maps. Browsers that ignore imageOrientation fall back to it.
const flipWorks = (async () => {
  try {
    const c = new OffscreenCanvas(1, 2), g = c.getContext('2d');
    g.fillStyle = '#f00'; g.fillRect(0, 0, 1, 1);
    g.fillStyle = '#00f'; g.fillRect(0, 1, 1, 1);
    const bm = await createImageBitmap(c, { imageOrientation: 'flipY' });
    const d = new OffscreenCanvas(1, 2), h = d.getContext('2d');
    h.drawImage(bm, 0, 0);
    return h.getImageData(0, 0, 1, 1).data[2] > 128; // the blue pixel is now on top
  } catch {
    return false;
  }
})();
const plain = new THREE.TextureLoader();

// three.js allocates texture storage first and then copies the image in; for sRGB textures Chrome takes
// that path slowly (~0.8 s per 8k map, against ~0.05 s for a direct texImage2D). So each decoded map is
// uploaded here directly, with three's defaults (clamped, trilinear mipmaps, the texture's anisotropy),
// and handed to three as already uploaded. These textures are never disposed.
let renderer = null;
export function useRenderer(r) { renderer = r; }
function upload(t, bitmap, srgb) {
  const gl = renderer.getContext();
  const tex = gl.createTexture();
  renderer.state.bindTexture(gl.TEXTURE_2D, tex); // keeps three's record of the bound texture right
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(t.anisotropy, renderer.capabilities.getMaxAnisotropy()));
  gl.generateMipmap(gl.TEXTURE_2D);
  renderer.state.unbindTexture();
  const p = renderer.properties.get(t);
  p.__webglTexture = tex; p.__webglInit = true; p.__version = t.version;
}

/** A texture that fills in when its image arrives; done(texture) is called on load or on error. */
export function loadTexture(url, { srgb = true, anisotropy = 8, done } = {}) {
  const t = new THREE.Texture();
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  const fail = () => done?.(t);
  flipWorks.then((ok) => {
    if (!ok) {
      plain.load(url, (img) => { t.image = img.image; t.needsUpdate = true; done?.(t); }, undefined, fail);
      return;
    }
    fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((b) => createImageBitmap(b, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: srgb ? 'default' : 'none' }))
      .then((bm) => {
        t.image = bm; t.flipY = false;
        if (renderer) upload(t, bm, srgb); else t.needsUpdate = true;
        done?.(t);
      })
      .catch(fail);
  });
  return t;
}

export const loadTextureAsync = (url, opts) => new Promise((r) => loadTexture(url, { ...opts, done: r }));
