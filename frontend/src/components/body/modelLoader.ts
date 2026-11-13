import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export const BODY_MODEL_URL = '/models/body.glb'
export const MUSCLES_MODEL_URL = '/models/muscles.glb'

/**
 * Loads a GLB from the app's own files, decompressing Meshopt with the
 * decoder bundled from three.js. Nothing is fetched from another site: no
 * Draco and no remote decoder (which is why drei's useGLTF is not used here,
 * since it carries a gstatic.com decoder address).
 */
export function useModel(url: string) {
  return useLoader(GLTFLoader, url, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder)
  })
}
