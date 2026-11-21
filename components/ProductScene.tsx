'use client';

import { useEffect, useRef, useState } from 'react';

/** Decorative only. No text, navigation or product state depends on WebGL. */
export function ProductScene() {
  const host = useRef<HTMLDivElement>(null);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const update = () => setAllowed(!motion.matches && !connection?.saveData);
    update();
    motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const node = host.current;
    if (!allowed || !node || !('IntersectionObserver' in window)) return;
    let disposed = false, visible = false, started = false, frame = 0;
    let stopScene: (() => void) | undefined;
    let resize: ResizeObserver | undefined;
    let draw: ((time: number) => void) | undefined;
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const resume = () => { if (!disposed && visible && !document.hidden && !frame && draw) frame = requestAnimationFrame(draw); };
    const visibility = () => { if (document.hidden) stop(); else resume(); };
    const start = async () => {
      if (started) return;
      started = true;
      try {
        // This chunk is not requested until the decoration approaches view.
        const THREE = await import('three');
        if (disposed) return;
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
        camera.position.set(0, 0, 8);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        const group = new THREE.Group(); scene.add(group);
        const geometries: import('three').BufferGeometry[] = [];
        const materials: import('three').Material[] = [];
        stopScene = () => {
          renderer.domElement.remove();
          geometries.forEach(g => g.dispose());
          materials.forEach(m => m.dispose());
          renderer.dispose();
          delete node.dataset.webglReady;
        };
        scene.add(new THREE.HemisphereLight(0xffffff, 0x1f4d3a, 2.8));
        const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 5, 5); scene.add(light);
        const plate = new THREE.MeshStandardMaterial({ color: 0xf3f0e9, roughness: 0.32, metalness: 0.12 });
        const forest = new THREE.MeshStandardMaterial({ color: 0x1f4d3a, roughness: 0.35, metalness: 0.4 });
        const gold = new THREE.MeshStandardMaterial({ color: 0xb98a4b, roughness: 0.3, metalness: 0.55 });
        materials.push(plate, forest, gold);
        const rings = [{ r: 1.25, tube: 0.15, material: plate }, { r: 1.53, tube: 0.025, material: gold }, { r: 0.98, tube: 0.018, material: forest }];
        rings.forEach(({r, tube, material}) => {
          const geometry = new THREE.TorusGeometry(r, tube, 16, 80); geometries.push(geometry);
          group.add(new THREE.Mesh(geometry, material));
        });
        const orbit = new THREE.Group(); group.add(orbit);
        for (let i = 0; i < 3; i++) {
          const geometry = new THREE.SphereGeometry(0.075, 16, 12); geometries.push(geometry);
          const dot = new THREE.Mesh(geometry, i === 1 ? gold : forest);
          const angle = i * Math.PI * 2 / 3; dot.position.set(Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, 0.12); orbit.add(dot);
        }
        group.rotation.set(0.65, -0.35, -0.25);
        const size = () => {
          const { width, height } = node.getBoundingClientRect();
          if (!width || !height) return;
          renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
        };
        resize = new ResizeObserver(size); resize.observe(node); size();
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
        renderer.domElement.addEventListener('webglcontextlost', event => {
          event.preventDefault(); visible = false; stop(); renderer.domElement.style.visibility = 'hidden';
          delete node.dataset.webglReady;
        });
        node.append(renderer.domElement);
        let elapsed = 0, previous = 0;
        draw = time => {
          frame = 0;
          if (disposed || !visible || document.hidden) return;
          // Render at at most 30fps; use active time so resuming never jumps.
          if (time - previous >= 1000 / 30) {
            elapsed += Math.min(time - previous, 50) / 1000; previous = time;
            const section = node.closest('section')!;
            const rect = section.getBoundingClientRect();
            const scroll = Math.max(-1, Math.min(1, (innerHeight / 2 - rect.top) / (rect.height + innerHeight)));
            group.rotation.x = 0.65 + scroll * 0.55;
            group.rotation.y = -0.35 + Math.sin(elapsed * 0.22) * 0.18;
            group.rotation.z = -0.25 + scroll * 0.3;
            orbit.rotation.z = elapsed * 0.12;
            group.position.y = Math.sin(elapsed * 0.65) * 0.06;
            renderer.render(scene, camera);
            node.dataset.webglReady = 'true';
          }
          frame = requestAnimationFrame(draw!);
        };
        resume();
      } catch {
        // Blocked GPU, failed chunk, or context budget: leave the static motif.
        stop(); resize?.disconnect(); stopScene?.(); stopScene = undefined;
      }
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible) { void start(); resume(); } else stop();
    }, { rootMargin: '80px', threshold: 0 });
    observer.observe(node);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true; observer.disconnect(); resize?.disconnect(); stop();
      document.removeEventListener('visibilitychange', visibility); stopScene?.();
    };
  }, [allowed]);

  return (
    <div ref={host} data-product-scene aria-hidden="true" className="pointer-events-none relative mt-7 h-[200px] w-full max-w-[350px] overflow-hidden rounded-[24px] bg-[radial-gradient(ellipse_at_center,rgba(31,77,58,0.07),transparent_70%)] sm:h-[240px] [&[data-webgl-ready]_svg]:opacity-0">
      <svg viewBox="0 0 350 240" className="absolute inset-0 size-full text-forest/20" fill="none"><ellipse cx="175" cy="120" rx="100" ry="65" stroke="currentColor" strokeWidth="12" transform="rotate(-18 175 120)" /><ellipse cx="175" cy="120" rx="125" ry="82" stroke="#B98A4B" strokeOpacity=".5" transform="rotate(-18 175 120)" /><circle cx="66" cy="136" r="5" fill="currentColor" /></svg>
    </div>
  );
}
