<script lang="ts" module>
  /** Outline icons, 24×24, drawn for this project. */
  const paths = {
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
    home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
    battery:
      'M5.5 7h12A2.5 2.5 0 0 1 20 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 3 14.5v-5A2.5 2.5 0 0 1 5.5 7zM22 10.5v3',
    grid: 'M9 3v4M15 3v4M7 7h10v3.5a5 5 0 0 1-10 0zM12 15.5V21',
    thermometer: 'M10 14.3V5.5a2 2 0 0 1 4 0v8.8a4 4 0 1 1-4 0z',
    droplet: 'M12 3.5c3 3.6 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 3-6.9 6-10.5z',
    forecast: 'M3 17.5 8 12l4 3 4-5M17.5 8.5 21 5M20 5h1v1',
    target: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    info: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 11v5.5M12 7.6v.2',
    overview:
      'M5 4.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM14 4.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5zM5 13.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5zM14 13.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5z',
    bolt: 'M13 3 5.5 13.5H12L11 21l7.5-10.5H12z',
    wrench:
      'M14.5 4.5a4.5 4.5 0 0 0-4.2 6.1L4.6 16.3a1.6 1.6 0 0 0 2.3 2.3l5.7-5.7a4.5 4.5 0 0 0 6.1-4.2l-2.6 2.6-2.4-.6-.6-2.4z',
    leaf: 'M5 19c0-8 5-13.5 14-14 .5 9-5 14-12 14zM5 19c3-4 6-6.5 9-8',
    clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2',
    cloud: 'M7.5 18.5h9.5a3.75 3.75 0 0 0 .4-7.5 5.5 5.5 0 0 0-10.6 1.2A3.2 3.2 0 0 0 7.5 18.5z',
    cloudSun:
      'M9 5.5V4M4.6 7.1l-1-1M3.5 11.5H2M8.6 8.2a3.4 3.4 0 0 0-4.2 4.6M8.5 19.5h8.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.1 3 3 0 0 0 .8 5.9z',
    rain: 'M7.5 15.5h9.5a3.75 3.75 0 0 0 .4-7.5 5.5 5.5 0 0 0-10.6 1.2 3.2 3.2 0 0 0 .7 6.3zM9 18.5l-1 2M13 18.5l-1 2M17 18.5l-1 2',
    plugCar:
      'M5 13.5l1.6-4.3A2 2 0 0 1 8.5 8h7a2 2 0 0 1 1.9 1.2l1.6 4.3M4.5 13.5h15a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2.5a1 1 0 0 1 1-1zM7 18v1.5M17 18v1.5M7.5 15.8h.01M16.5 15.8h.01',
    close: 'M7 7l10 10M17 7 7 17',
    haze: 'M7.5 10a4.5 4.5 0 0 1 9 0M12 2.5v1.5M5.2 4.7l1 1M18.8 4.7l-1 1M3.5 13.5h17M5.5 17h13M8 20.5h8',
    calendar: 'M5 6.5h14v13H5zM5 10.5h14M9 4v4M15 4v4',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    okCircle: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.2 12.3l2.6 2.6 5-5.4',
    lookCircle: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.6V13M12 16.2v.2',
    actCircle: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9 9l6 6M15 9l-6 6',
    contrast: 'M12 3.5a8.5 8.5 0 1 0 0 17zM12 3.5a8.5 8.5 0 1 1 0 17',
    floorplan: 'M4 4.5h16v15H4zM4 12h7M11 4.5V8M11 15.5v4M15 12h5M15 12V9',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    chevron: 'M9 6l6 6-6 6',
    eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    comment:
      'M4.5 5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4.5 3.5V16h-1.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    undo: 'M9 5.5 4.5 10 9 14.5M4.5 10H15a4.5 4.5 0 0 1 0 9h-3.5',
    sliders: 'M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4',
  } as const;
  export type IconName = keyof typeof paths;
  /** A name from outside (e.g. a board's tab) as an icon; unknown names get "info". */
  export const iconOf = (name: string): IconName =>
    Object.hasOwn(paths, name) ? (name as IconName) : 'info';
</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
  {#if name === 'sun'}
    <!-- the sun is filled: as an outline it read like a gear -->
    <circle cx="12" cy="12" r="4" fill="currentColor" />
  {/if}
</svg>
