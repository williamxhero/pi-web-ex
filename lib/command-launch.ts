// Direct first-party background launches. Child tools still own any processes they spawn.
export const silentCommandLaunch = { windowsHide: true, shell: false } as const;
