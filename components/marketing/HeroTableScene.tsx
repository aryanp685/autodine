'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The hero's table setting: a quiet 3D still-life of the moment before a
 * guest orders — plate, glass, brass cutlery and the table card that starts
 * the whole product.
 *
 * The scene is decorative. No copy, navigation or product state depends on
 * WebGL, so every failure path lands on the drawn fallback: reduced motion,
 * data saver, a missing chunk, a lost context or a device that refuses a
 * renderer. Everything is disposed on unmount.
 */
export function HeroTableScene() {
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

    let disposed = false;
    let visible = false;
    let started = false;
    let frame = 0;
    let stopScene: (() => void) | undefined;
    let resize: ResizeObserver | undefined;
    let draw: ((time: number) => void) | undefined;

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const resume = () => {
      if (!disposed && visible && !document.hidden && !frame && draw) frame = requestAnimationFrame(draw);
    };
    const visibility = () => {
      if (document.hidden) stop();
      else resume();
    };

    const start = async () => {
      if (started) return;
      started = true;
      try {
        const THREE = await import('three');
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: 'low-power',
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
        camera.position.set(0, 4.6, 6.6);
        camera.lookAt(-0.55, 0.3, 0);

        const group = new THREE.Group();
        group.rotation.set(0.06, -0.22, 0);
        scene.add(group);

        const geometries: import('three').BufferGeometry[] = [];
        const materials: import('three').Material[] = [];
        const add = <T extends import('three').Mesh>(mesh: T) => {
          group.add(mesh);
          return mesh;
        };
        const cylinder = (rTop: number, rBottom: number, height: number, segments = 64) => {
          const geometry = new THREE.CylinderGeometry(rTop, rBottom, height, segments);
          geometries.push(geometry);
          return geometry;
        };
        const torus = (radius: number, tube: number, segments = 96) => {
          const geometry = new THREE.TorusGeometry(radius, tube, 20, segments);
          geometries.push(geometry);
          return geometry;
        };
        const box = (w: number, h: number, d: number) => {
          const geometry = new THREE.BoxGeometry(w, h, d);
          geometries.push(geometry);
          return geometry;
        };
        const sphere = (radius: number) => {
          const geometry = new THREE.SphereGeometry(radius, 24, 18);
          geometries.push(geometry);
          return geometry;
        };
        const material = (options: import('three').MeshStandardMaterialParameters) => {
          const m = new THREE.MeshStandardMaterial(options);
          materials.push(m);
          return m;
        };

        /* ---------------------------------------------------------- light */
        scene.add(new THREE.HemisphereLight(0xfff8ec, 0x7a6a52, 1.35));
        const key = new THREE.DirectionalLight(0xfff4e2, 2.6);
        key.position.set(3.4, 6.2, 4.2);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xffe9cf, 0.55);
        fill.position.set(-4.2, 2.4, -2.4);
        scene.add(fill);
        const rimLight = new THREE.DirectionalLight(0xdfe9de, 0.7);
        rimLight.position.set(-1.2, 3.2, -4.4);
        scene.add(rimLight);

        /* ---------------------------------------------------------- table */
        const table = material({ color: 0xf0e7d7, roughness: 0.94, metalness: 0.02 });
        add(new THREE.Mesh(cylinder(3.25, 3.32, 0.16, 96), table)).position.y = -0.1;

        const cloth = material({ color: 0xfaf5ea, roughness: 0.96, metalness: 0 });
        add(new THREE.Mesh(cylinder(3.0, 3.0, 0.02, 96), cloth)).position.y = -0.005;

        /* ---------------------------------------------------------- plate */
        const porcelain = material({ color: 0xfdfbf6, roughness: 0.28, metalness: 0.04 });
        const porcelainLine = material({ color: 0x1f4d3a, roughness: 0.42, metalness: 0.1 });
        const plate = new THREE.Group();
        plate.position.set(-0.62, 0.03, 0.28);
        const plateBody = new THREE.Mesh(cylinder(1.28, 1.2, 0.06, 96), porcelain);
        plateBody.position.y = 0.03;
        plate.add(plateBody);
        const rim = new THREE.Mesh(torus(1.12, 0.028), porcelainLine);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.065;
        plate.add(rim);
        const well = new THREE.Mesh(cylinder(0.82, 0.86, 0.012, 72), porcelain);
        well.position.y = 0.062;
        plate.add(well);
        const shade = new THREE.Mesh(cylinder(1.24, 1.24, 0.004, 72), material({
          color: 0xd9cbb4,
          roughness: 1,
          transparent: true,
          opacity: 0.28,
        }));
        shade.position.y = 0.058;
        plate.add(shade);
        group.add(plate);

        /* ----------------------------------------------------------- glass */
        const glassMaterial = material({
          color: 0xdfe9ef,
          roughness: 0.08,
          metalness: 0.02,
          transparent: true,
          opacity: 0.34,
          side: THREE.DoubleSide,
        });
        const glass = new THREE.Group();
        glass.position.set(1.12, 0.02, -0.28);
        const glassBody = new THREE.Mesh(cylinder(0.26, 0.21, 1.0, 48), glassMaterial);
        glassBody.position.y = 0.52;
        glass.add(glassBody);
        const glassBase = new THREE.Mesh(cylinder(0.2, 0.21, 0.035, 48), glassMaterial);
        glass.add(glassBase);
        const water = new THREE.Mesh(cylinder(0.235, 0.2, 0.42, 48), material({
          color: 0xcfe0dd,
          roughness: 0.18,
          metalness: 0,
          transparent: true,
          opacity: 0.5,
        }));
        water.position.y = 0.3;
        glass.add(water);
        group.add(glass);

        /* --------------------------------------------------------- cutlery */
        const brass = material({ color: 0xc39a5c, roughness: 0.26, metalness: 0.82 });
        const fork = new THREE.Group();
        fork.position.set(-2.35, 0.045, 0.32);
        fork.rotation.y = 0.24;
        const forkHandle = new THREE.Mesh(box(0.065, 0.035, 0.98), brass);
        forkHandle.position.z = -0.1;
        fork.add(forkHandle);
        for (let i = 0; i < 3; i += 1) {
          const tine = new THREE.Mesh(box(0.032, 0.032, 0.2), brass);
          tine.position.set((i - 1) * 0.052, 0, 0.46);
          fork.add(tine);
        }
        group.add(fork);

        const knife = new THREE.Group();
        knife.position.set(-2.64, 0.045, 0.3);
        knife.rotation.y = 0.24;
        const knifeBlade = new THREE.Mesh(box(0.07, 0.03, 0.56), brass);
        knifeBlade.position.z = 0.3;
        knife.add(knifeBlade);
        const knifeHandle = new THREE.Mesh(box(0.075, 0.04, 0.48), brass);
        knifeHandle.position.z = -0.22;
        knife.add(knifeHandle);
        group.add(knife);

        /* ------------------------------------------------------ table card */
        const card = new THREE.Group();
        card.position.set(-1.42, 0.045, 1.16);
        card.rotation.y = 0.5;
        const cardBody = new THREE.Mesh(box(1.02, 0.035, 1.16), material({
          color: 0xfffdf8,
          roughness: 0.62,
          metalness: 0.02,
        }));
        card.add(cardBody);
        const ink = material({ color: 0x1f4d3a, roughness: 0.55, metalness: 0.05 });
        card.add(new THREE.Mesh(box(0.44, 0.008, 0.1), ink));
        const grid = new THREE.Group();
        grid.position.set(0, 0.024, -0.23);
        const cell = 0.042;
        const gap = 0.058;
        for (let row = 0; row < 5; row += 1) {
          for (let col = 0; col < 5; col += 1) {
            if ((row + col) % 3 === 0 || (row === 0 && col < 2) || (row === 4 && col > 2)) {
              const dot = new THREE.Mesh(box(cell, 0.008, cell), ink);
              dot.position.set((col - 2) * gap, 0, (row - 2) * gap);
              grid.add(dot);
            }
          }
        }
        card.add(grid);
        const brassDot = new THREE.Mesh(sphere(0.085), brass);
        brassDot.position.set(0, 0.028, 0.38);
        card.add(brassDot);
        group.add(card);

        /* ---------------------------------------------------- small pieces */
        const napkin = new THREE.Mesh(box(0.5, 0.02, 0.34), material({
          color: 0x2f4a3d,
          roughness: 0.9,
          metalness: 0.02,
        }));
        napkin.position.set(1.98, 0.035, 0.78);
        napkin.rotation.y = 0.5;
        group.add(napkin);

        const olive = material({ color: 0x4c5c37, roughness: 0.7, metalness: 0.02 });
        const olives = new THREE.Group();
        olives.position.set(-0.58, 0.12, 0.3);
        for (let i = 0; i < 3; i += 1) {
          const one = new THREE.Mesh(sphere(0.088), olive);
          one.scale.y = 0.7;
          one.position.set(Math.cos(i * 2.1) * 0.24, 0, Math.sin(i * 2.1) * 0.24);
          olives.add(one);
        }
        group.add(olives);

        const leaf = material({ color: 0x6f7d50, roughness: 0.72, metalness: 0 });
        for (let i = 0; i < 3; i += 1) {
          const blade = new THREE.Mesh(box(0.06, 0.012, 0.3), leaf);
          blade.position.set(-0.16 + i * 0.14, 0.1, 0.06 - i * 0.05);
          blade.rotation.y = 0.6 + i * 0.24;
          group.add(blade);
        }

        /* ------------------------------------------------------- pointers */
        const pointer = { x: 0, y: 0 };
        const target = { x: 0, y: 0 };
        const onPointer = (event: PointerEvent) => {
          const rect = node.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          target.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
          target.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        };
        window.addEventListener('pointermove', onPointer, { passive: true });

        const size = () => {
          const { width, height } = node.getBoundingClientRect();
          if (!width || !height) return;
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        resize = new ResizeObserver(size);
        resize.observe(node);
        size();

        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
        renderer.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          visible = false;
          stop();
          renderer.domElement.style.visibility = 'hidden';
          delete node.dataset.webglReady;
        });
        node.append(renderer.domElement);

        let elapsed = 0;
        let previous = 0;
        draw = (time) => {
          frame = 0;
          if (disposed || !visible || document.hidden) return;
          if (time - previous >= 1000 / 30) {
            elapsed += Math.min(time - previous, 50) / 1000;
            previous = time;
            pointer.x += (target.x - pointer.x) * 0.045;
            pointer.y += (target.y - pointer.y) * 0.045;
            group.rotation.y = -0.22 + Math.sin(elapsed * 0.16) * 0.06 + pointer.x * 0.055;
            group.rotation.x = 0.06 - pointer.y * 0.028;
            group.position.y = Math.sin(elapsed * 0.45) * 0.018;
            renderer.render(scene, camera);
            node.dataset.webglReady = 'true';
          }
          frame = requestAnimationFrame(draw!);
        };
        resume();

        stopScene = () => {
          window.removeEventListener('pointermove', onPointer);
          renderer.domElement.remove();
          geometries.forEach((g) => g.dispose());
          materials.forEach((m) => m.dispose());
          renderer.dispose();
          delete node.dataset.webglReady;
        };
      } catch {
        stop();
        resize?.disconnect();
        stopScene?.();
        stopScene = undefined;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? false;
        if (visible) {
          void start();
          resume();
        } else {
          stop();
        }
      },
      { rootMargin: '120px', threshold: 0 },
    );
    observer.observe(node);
    document.addEventListener('visibilitychange', visibility);

    return () => {
      disposed = true;
      observer.disconnect();
      resize?.disconnect();
      stop();
      document.removeEventListener('visibilitychange', visibility);
      stopScene?.();
    };
  }, [allowed]);

  return (
    <div
      ref={host}
      aria-hidden="true"
      data-hero-stage
      className="pointer-events-none absolute inset-0 [&[data-webgl-ready]_svg]:opacity-0"
    >
      <svg viewBox="0 0 560 520" className="absolute inset-0 size-full transition-opacity duration-700" fill="none">
        <defs>
          <radialGradient id="hero-plate" cx="50%" cy="42%" r="66%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="72%" stopColor="#fbf6ec" />
            <stop offset="100%" stopColor="#efe5d3" />
          </radialGradient>
          <radialGradient id="hero-wash" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="rgba(185,138,75,0.16)" />
            <stop offset="100%" stopColor="rgba(185,138,75,0)" />
          </radialGradient>
        </defs>
        <ellipse cx="280" cy="300" rx="250" ry="190" fill="url(#hero-wash)" />
        <ellipse cx="270" cy="322" rx="196" ry="70" fill="#e7dcc8" opacity="0.55" />
        <ellipse cx="262" cy="306" rx="150" ry="54" fill="url(#hero-plate)" />
        <ellipse cx="262" cy="306" rx="150" ry="54" stroke="#1f4d3a" strokeOpacity="0.35" strokeWidth="1.5" />
        <ellipse cx="262" cy="306" rx="108" ry="38" fill="#fffdf8" />
        <ellipse cx="262" cy="306" rx="108" ry="38" stroke="#1f4d3a" strokeOpacity="0.14" />
        <g opacity="0.75">
          <ellipse cx="402" cy="262" rx="30" ry="56" fill="#eef2f1" stroke="#bac9c5" />
          <ellipse cx="402" cy="262" rx="30" ry="56" fill="#dce8e6" opacity="0.6" />
        </g>
        <g stroke="#c39a5c" strokeLinecap="round">
          <path d="M150 330l-42-96" strokeWidth="5" />
          <path d="M140 322l-34-84" strokeWidth="2" opacity="0.6" />
          <path d="M120 336l-44-92" strokeWidth="5" />
        </g>
        <g transform="translate(372 330) rotate(-14)">
          <rect width="128" height="148" rx="8" fill="#fffdf8" stroke="#e2d7c4" />
          <g fill="#1f4d3a">
            {Array.from({ length: 5 }).flatMap((_, row) =>
              Array.from({ length: 5 }).map((__, col) =>
                (row + col) % 3 === 0 ? (
                  <rect key={`${row}-${col}`} x={18 + col * 14} y={18 + row * 14} width="9" height="9" rx="1.5" />
                ) : null,
              ),
            )}
          </g>
          <rect x="18" y="98" width="54" height="7" rx="3.5" fill="#1f4d3a" opacity="0.35" />
          <circle cx="104" cy="102" r="9" fill="#c39a5c" />
        </g>
      </svg>
    </div>
  );
}
