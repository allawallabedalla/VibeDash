<script lang="ts">
  /**
   * The floor plan in 3D (three.js, loaded only when 3D is chosen): walls
   * raised from the house's solid model, each room's floor in the colour of
   * the view. By day a low sun with soft shadows; for light the house goes
   * dark and lit rooms get a real warm light that shines onto the walls;
   * motion glows as a pulsing orb. Drag to turn, pinch or scroll to zoom, tap
   * a room for its values; the floors can be lifted apart and the roof put on.
   * Turns slowly by itself until touched; renders only while it can be seen.
   */
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
  import type { BoardPlan, PlanViewKind, Solid } from '../model/board';
  import { colour } from '../model/planColors';
  import { t } from '../i18n/index.svelte';

  interface Props {
    plan: BoardPlan & { model3d: NonNullable<BoardPlan['model3d']> };
    kind: PlanViewKind | undefined;
    valueOf: (id: string) => number | null;
    textOf: (id: string) => string;
    /** changes whenever values may have changed (view, replay step, data) */
    tick: unknown;
    selected: string | null;
    onselect: (id: string | null) => void;
  }
  let { plan, kind, valueOf, textOf, tick, selected, onselect }: Props = $props();

  let box = $state<HTMLDivElement>();
  // floors side by side by default (both visible); stacked shows the real house, with roof
  let apart = $state(true);
  let roofOn = $state(false);
  let ready = $state(false);
  let failed = $state(false);

  // three.js objects live outside Svelte's reactivity
  let api: {
    paint: () => void;
    setApart: (on: boolean) => void;
    setRoof: (on: boolean) => void;
    select: (id: string | null) => void;
    resetView: () => void;
  } | null = null;

  onMount(() => {
    const stage = box;
    if (!stage) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      failed = true;
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const css = (n: string, f: string) => getComputedStyle(stage).getPropertyValue(n).trim() || f;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'labels3d';
    stage.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const m3 = plan.model3d;
    // plan (x, y) → three (X = x, Z = y), height → Y; framing by the rooms
    // indoors only (a barn or yard would push the house to the edge)
    const inner = plan.floors.flatMap((f) =>
      f.rooms.filter((r) => r.kind === 'room').flatMap((r) => r.polygon),
    );
    const all = inner.length
      ? inner
      : plan.floors.flatMap((f) => f.rooms.flatMap((r) => r.polygon));
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 8);
    // side by side: each upper floor moves one house width (plus a gap) along X
    const shiftX = Math.max(...xs) - Math.min(...xs) + 3;
    const nFloors = plan.model3d.floors.length;
    // upper floors go to the -X side (a barn or yard tends to sit on the other)
    const centreAt = (f: number) =>
      new THREE.Vector3(cx - ((nFloors - 1) * shiftX * f) / 2, 1.2, cz);
    // narrow (phone): step back so the whole house fits the width
    let fit = 1;
    let touched = false;
    const homeAt = (f: number) => {
      const c = centreAt(f);
      const d = span * (1.45 + 0.75 * f * (nFloors - 1)) * fit;
      return new THREE.Vector3(c.x - d * 0.55, d * 1.0, c.z + d * 1.0);
    };

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
    camera.position.copy(homeAt(1));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(centreAt(1));
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = span * 0.4;
    controls.maxDistance = span * 4;
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = 0.5;
    controls.update();

    // ── light ────────────────────────────────────────────────────────────────
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(cx - span, span * 1.4, cz + span * 0.6);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -span;
    sc.right = sc.top = span;
    sc.far = span * 5;
    sun.shadow.radius = 4;
    scene.add(sun, sun.target);

    // ── materials ────────────────────────────────────────────────────────────
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.92 });
    const blockMat = new THREE.MeshStandardMaterial({
      color: 0xd8d4cc,
      roughness: 0.95,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x8c5a46,
      roughness: 0.8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    const stairMat = new THREE.MeshStandardMaterial({ color: 0xb98a5c, roughness: 0.7 });
    const floorCol = new THREE.Color(css('--surface-2', '#ececf0'));

    const shape = (s: Solid) => {
      const sh = new THREE.Shape(s.outer.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of s.holes)
        sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return sh;
    };
    /** extrude a plan shape upwards from `base` by `h` */
    const raise = (sh: THREE.Shape | THREE.Shape[], base: number, h: number) => {
      const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      g.translate(0, base + h, 0);
      return g;
    };

    // ── floors: wall mass + one slab per room ───────────────────────────────
    interface Room {
      id: string;
      mesh: THREE.Mesh;
      mat: THREE.MeshStandardMaterial;
      light?: THREE.PointLight;
      orb?: THREE.Mesh;
      label: CSS2DObject;
      kind: string;
      base: number;
    }
    const rooms: Room[] = [];
    const topBase = Math.max(...m3.floors.map((f) => f.base));
    const floorGroups: { group: THREE.Group; lift: number; base: number }[] = [];
    m3.floors.forEach((f, i) => {
      const group = new THREE.Group();
      for (const w of f.walls) {
        const mesh = new THREE.Mesh(raise(shape(w), f.base, f.height), wallMat);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      }
      const pf = plan.floors.find((x) => x.id === f.id);
      for (const r of pf?.rooms ?? []) {
        if (r.kind === 'void') continue;
        const mat = new THREE.MeshStandardMaterial({
          color: floorCol.clone(),
          roughness: 0.85,
          transparent: r.kind === 'outside',
          opacity: r.kind === 'outside' ? 0.35 : 1,
        });
        const mesh = new THREE.Mesh(
          raise(new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y))), f.base, 0.06),
          mat,
        );
        mesh.receiveShadow = true;
        mesh.userData.room = r.id;
        group.add(mesh);
        const el = document.createElement('div');
        el.className = 'lbl3d';
        const label = new CSS2DObject(el);
        label.position.set(r.label[0], f.base + 0.35, r.label[1]);
        group.add(label);
        rooms.push({ id: r.id, mesh, mat, label, kind: r.kind, base: f.base });
      }
      scene.add(group);
      floorGroups.push({ group, lift: i, base: f.base });
    });
    for (const b of m3.blocks) {
      for (const w of b.walls)
        scene.add(new THREE.Mesh(raise(shape(w), b.base, b.height), blockMat));
    }
    for (const st of m3.stairs) {
      const d = (st.y1 - st.y0) / st.steps;
      for (let i = 0; i < st.steps; i++) {
        const tread = new THREE.Mesh(
          new THREE.BoxGeometry(st.x1 - st.x0, 0.05, d * 1.02),
          stairMat,
        );
        tread.position.set(
          (st.x0 + st.x1) / 2,
          st.base + ((i + 1) * st.height) / st.steps,
          st.y0 + (i + 0.5) * d,
        );
        tread.castShadow = true;
        floorGroups[0]?.group.add(tread);
      }
    }
    const roof = new THREE.Group();
    for (const face of m3.roof) {
      const pos: number[] = [];
      for (let i = 1; i < face.length - 1; i++) {
        for (const p of [face[0]!, face[i]!, face[i + 1]!]) pos.push(p[0], p[2], p[1]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, roofMat);
      mesh.castShadow = true;
      roof.add(mesh);
    }
    roof.visible = false;
    scene.add(roof);

    // ── paint: colours, night, lights, orbs, labels ─────────────────────────
    const warm = new THREE.Color(0xffc36b);
    const orbGeo = new THREE.SphereGeometry(0.32, 24, 16);
    let pulsing = false;
    const paint = () => {
      const night = kind === 'light';
      scene.background = night ? new THREE.Color(0x0f1420) : null;
      hemi.intensity = night ? 0.12 : 1.6;
      sun.intensity = night ? 0 : 2.2;
      wallMat.color.set(night ? 0x3a4256 : 0xf2efe9);
      pulsing = false;
      for (const r of rooms) {
        const v = valueOf(r.id);
        const c = kind ? colour(kind, v) : null;
        r.mat.emissive.set(0x000000);
        r.mat.emissiveIntensity = 0;
        if (night) {
          r.mat.color.set(r.kind === 'outside' ? 0x0f1420 : 0x1d2433);
          if (v === 1) {
            r.mat.color.copy(warm);
            r.mat.emissive.copy(warm);
            r.mat.emissiveIntensity = 0.9;
            if (!r.light) {
              r.light = new THREE.PointLight(0xffc36b, 9, 7.5, 1.6);
              const p = r.label.position;
              r.light.position.set(p.x, r.base + 2.3, p.z);
              r.mesh.parent?.add(r.light);
            }
            r.light.visible = true;
          } else if (r.light) r.light.visible = false;
        } else {
          if (r.light) r.light.visible = false;
          r.mat.color.set(r.kind === 'outside' ? floorCol : (c ?? floorCol));
          if (c && c.startsWith('rgba')) {
            // valve: rgba → colour + opacity-like strength as emissive glow
            r.mat.color.set(0xff7a45);
          }
        }
        if (kind === 'presence' && v !== null && v <= 15) {
          if (!r.orb) {
            r.orb = new THREE.Mesh(
              orbGeo,
              new THREE.MeshStandardMaterial({
                color: 0x5e5ce6,
                emissive: 0x5e5ce6,
                emissiveIntensity: 1.2,
              }),
            );
            const p = r.label.position;
            r.orb.position.set(p.x, r.base + 1.2, p.z);
            r.mesh.parent?.add(r.orb);
          }
          r.orb.visible = true;
          r.orb.userData.fresh = Math.max(0.35, 1 - v / 15);
          pulsing = true;
        } else if (r.orb) r.orb.visible = false;
        r.mat.needsUpdate = true;
        // stacked: the floors below are hidden by the ones above – their numbers too
        const hidden =
          (r.kind === 'outside' || (liftTarget < 0.5 && r.base < topBase)) && selected !== r.id;
        const txt = hidden ? '' : textOf(r.id);
        const el = r.label.element as HTMLDivElement;
        el.textContent = txt;
        el.style.display = txt ? '' : 'none';
        el.style.color = night ? '#ffffff' : '';
        el.style.textShadow = night ? '0 0 6px #0f1420' : '';
        el.classList.toggle('sel', selected === r.id);
      }
      wake();
    };

    // ── interaction ──────────────────────────────────────────────────────────
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      touched = true;
      controls.autoRotate = false;
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(rooms.map((x) => x.mesh))[0];
      onselect((hit?.object.userData.room as string | undefined) ?? null);
    });
    controls.addEventListener('change', () => wake());

    // ── size, loop only while visible and something moves ───────────────────
    const resize = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      fit = Math.max(1, 1.35 / camera.aspect);
      if (!touched) {
        camera.position.copy(homeAt(liftTarget));
        controls.target.copy(centreAt(liftTarget));
        controls.update();
      }
      wake();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      wake();
    });
    io.observe(stage);
    let raf = 0;
    let lifting = 1;
    let liftTarget = 1;
    const frame = (now: number) => {
      raf = 0;
      controls.update();
      lifting += (liftTarget - lifting) * 0.12;
      floorGroups.forEach((g) => {
        g.group.position.x = -g.lift * shiftX * lifting;
        g.group.position.y = -g.base * lifting;
      });
      if (pulsing && !reduce) {
        for (const r of rooms) {
          if (r.orb?.visible)
            r.orb.scale.setScalar(
              0.8 + 0.25 * (1 + Math.sin(now / 280)) * (r.orb.userData.fresh as number),
            );
        }
      }
      renderer.render(scene, camera);
      labels.render(scene, camera);
      const moving =
        controls.autoRotate || Math.abs(liftTarget - lifting) > 0.002 || (pulsing && !reduce);
      if (moving && visible && document.visibilityState === 'visible')
        raf = requestAnimationFrame(frame);
    };
    function wake() {
      if (!raf && visible) raf = requestAnimationFrame(frame);
    }
    const onVis = () => wake();
    document.addEventListener('visibilitychange', onVis);

    api = {
      paint,
      setApart: (on) => {
        liftTarget = on ? 1 : 0;
        paint();
        if (on) {
          roof.visible = false;
          labels.domElement.style.display = '';
        }
        camera.position.copy(homeAt(liftTarget));
        controls.target.copy(centreAt(liftTarget));
        controls.update();
        wake();
      },
      setRoof: (on) => {
        roof.visible = on;
        labels.domElement.style.display = on ? 'none' : '';
        wake();
      },
      select: () => paint(),
      resetView: () => {
        camera.position.copy(homeAt(liftTarget));
        controls.target.copy(centreAt(liftTarget));
        controls.autoRotate = !reduce;
        controls.update();
        wake();
      },
    };
    resize();
    paint();
    ready = true;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
      api = null;
    };
  });

  // repaint when the view, the replay step, the data or the selection change
  $effect(() => {
    void kind;
    void tick;
    void selected;
    if (ready) api?.paint();
  });
  $effect(() => {
    if (ready) api?.setApart(apart);
  });
  $effect(() => {
    if (ready) api?.setRoof(roofOn);
  });
</script>

{#if failed}
  <p class="muted-note">{t('fp.no3d')}</p>
{:else}
  <div class="tools">
    <button type="button" class="chip" aria-pressed={!apart} onclick={() => (apart = !apart)}>
      {t('fp.stacked')}
    </button>
    {#if plan.model3d.roof.length && !apart}
      <button type="button" class="chip" aria-pressed={roofOn} onclick={() => (roofOn = !roofOn)}>
        {t('fp.roof')}
      </button>
    {/if}
    <button type="button" class="chip" onclick={() => api?.resetView()}>{t('fp.reset')}</button>
  </div>
  <div class="stage" bind:this={box} role="img" aria-label={t('fp.aria3d')}></div>
{/if}

<style>
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 8px 0;
  }
  .chip {
    min-height: 44px;
    padding: 0 16px;
    border-radius: 22px;
    border: 0;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--text-2);
    font: inherit;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--text);
    color: var(--surface);
  }
  .stage {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: 14px;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
  }
  @media (max-width: 600px) {
    .stage {
      aspect-ratio: 1 / 1.05;
    }
  }
  .stage :global(canvas) {
    display: block;
  }
  .stage :global(.labels3d) {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .stage :global(.lbl3d) {
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-shadow:
      0 0 4px var(--surface),
      0 0 8px var(--surface);
    white-space: nowrap;
  }
  .stage :global(.lbl3d.sel) {
    outline: 2px solid var(--text);
    outline-offset: 3px;
    border-radius: 4px;
  }
</style>
