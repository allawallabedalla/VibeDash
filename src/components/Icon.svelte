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
    close: 'M7 7l10 10M17 7 7 17',
    contrast: 'M12 3.5a8.5 8.5 0 1 0 0 17zM12 3.5a8.5 8.5 0 1 1 0 17',
  } as const;
  export type IconName = keyof typeof paths;
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
</svg>
