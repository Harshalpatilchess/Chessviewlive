
// Format helper: seconds -> HH:MM:SS or MM:SS
function formatSecondsToClock(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
}

export function useGameClock(
    baseWhiteSeconds: number, // Computed at parse time
    baseBlackSeconds: number,
    baseCapturedAt: string | number | undefined, // Time when those seconds were valid
    isLive: boolean,
    turnColor: 'w' | 'b',
    now: number, // Driven by parent interval
    fallbackWhite: string = '—',
    fallbackBlack: string = '—'
) {
    if (!isLive || !baseCapturedAt || (baseWhiteSeconds === 0 && baseBlackSeconds === 0)) {
        return {
            whiteDisplay: baseWhiteSeconds ? formatSecondsToClock(baseWhiteSeconds) : fallbackWhite,
            blackDisplay: baseBlackSeconds ? formatSecondsToClock(baseBlackSeconds) : fallbackBlack,
        };
    }

    const captureTime = typeof baseCapturedAt === 'string' ? new Date(baseCapturedAt).getTime() : baseCapturedAt;
    // How many seconds elapsed since the snapshot?
    const elapsedSeconds = Math.max(0, Math.floor((now - captureTime) / 1000));

    let currentWhite = baseWhiteSeconds;
    let currentBlack = baseBlackSeconds;

    if (turnColor === 'w') {
        currentWhite = Math.max(0, baseWhiteSeconds - elapsedSeconds);
    } else {
        currentBlack = Math.max(0, baseBlackSeconds - elapsedSeconds);
    }

    return {
        whiteDisplay: formatSecondsToClock(currentWhite),
        blackDisplay: formatSecondsToClock(currentBlack),
    };
}
