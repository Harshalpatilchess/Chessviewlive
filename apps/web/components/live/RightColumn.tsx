"use client";

import RightPaneTabs from "@/components/live/RightPaneTabs";
import VideoPane from "@/components/live/VideoPane";
import type { Ply } from "@/lib/chess/pgn";

type RightColumnProps = {
  plies: Ply[];
  index: number;
  setIndex: (i: number) => void;
  engineOn: boolean;
  setEngineOn: (v: boolean | ((prev: boolean) => boolean)) => void;
  replayHref?: string;
  offline?: boolean;
};

const RightColumn = ({
  plies,
  index,
  setIndex,
  engineOn,
  setEngineOn,
  replayHref,
  offline = true,
}: RightColumnProps) => {
  return (
    <aside className="flex h-full min-h-0 w-full flex-col gap-4 lg:gap-5">
      <VideoPane offline={offline} replayHref={replayHref} />
      <div className="flex min-h-0 flex-1 flex-col">
        <RightPaneTabs
          engineOn={engineOn}
          setEngineOn={setEngineOn}
          plies={plies}
          currentMoveIndex={index}
          onMoveSelect={setIndex}
          boardNavigation={[]}
        />
      </div>
    </aside>
  );
};

export default RightColumn;
