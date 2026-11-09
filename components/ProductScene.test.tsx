// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ renderers: 0, rendererDisposed: vi.fn(), geometryDisposed: vi.fn(), materialDisposed: vi.fn() }));
vi.mock('three', () => {
  class Object3D { position={set:vi.fn(),y:0}; rotation={set:vi.fn(),x:0,y:0,z:0}; add=vi.fn(); }
  class Geometry { dispose=mocks.geometryDisposed; }
  return {
    WebGLRenderer: class { domElement=document.createElement('canvas'); constructor(){mocks.renderers++;} setPixelRatio=vi.fn();setSize=vi.fn();render=vi.fn();dispose=mocks.rendererDisposed; },
    Scene:Object3D, Group:Object3D, Mesh:Object3D, HemisphereLight:Object3D, DirectionalLight:Object3D,
    PerspectiveCamera:class extends Object3D {aspect=1;updateProjectionMatrix=vi.fn();},
    MeshStandardMaterial:class {dispose=mocks.materialDisposed;}, TorusGeometry:Geometry,SphereGeometry:Geometry,
  };
});
import { ProductScene } from './ProductScene';
let root:Root, host:HTMLDivElement, intersect:IntersectionObserverCallback | undefined;
let reduced=false, mediaChange:(()=>void)|undefined;
beforeEach(()=>{
  mocks.renderers=0;vi.clearAllMocks();reduced=false;intersect=undefined;
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.stubGlobal('matchMedia',()=>({get matches(){return reduced;},addEventListener:(_type:string,fn:()=>void)=>{mediaChange=fn;},removeEventListener:vi.fn()}));
  vi.stubGlobal('IntersectionObserver',class {constructor(fn:IntersectionObserverCallback){intersect=fn;}observe=vi.fn();disconnect=vi.fn();});
  vi.stubGlobal('ResizeObserver',class {observe=vi.fn();disconnect=vi.fn();});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const mount=async()=>{await act(async()=>root.render(<section><ProductScene /></section>));};
const show=async()=>{await act(async()=>{intersect?.([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver);await new Promise(resolve=>setTimeout(resolve,25));});};
it('keeps a decorative static fallback without requesting a renderer before intersection',async()=>{
 await mount();expect(host.querySelector('[aria-hidden="true"] svg')).not.toBeNull();expect(host.querySelector('canvas')).toBeNull();expect(mocks.renderers).toBe(0);
});
it('does not initialise WebGL under reduced motion',async()=>{
 reduced=true;await mount();expect(intersect).toBeUndefined();expect(mocks.renderers).toBe(0);expect(host.querySelector('svg')).not.toBeNull();
});
it('disposes GPU resources when reduced motion is enabled after mounting',async()=>{
 await mount();await show();expect(host.querySelector('canvas')).not.toBeNull();expect(mocks.renderers).toBe(1);
 await act(async()=>{reduced=true;mediaChange?.();});
 expect(host.querySelector('canvas')).toBeNull();expect(mocks.rendererDisposed).toHaveBeenCalledTimes(1);expect(mocks.geometryDisposed).toHaveBeenCalledTimes(6);expect(mocks.materialDisposed).toHaveBeenCalledTimes(3);expect(host.querySelector('svg')).not.toBeNull();
});
it('releases its renderer and geometries on route unmount',async()=>{
 await mount();await show();await act(async()=>root.render(null));expect(mocks.rendererDisposed).toHaveBeenCalledTimes(1);expect(mocks.geometryDisposed).toHaveBeenCalledTimes(6);
});
