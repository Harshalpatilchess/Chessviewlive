import { redirect } from "next/navigation";
import { buildBroadcastBoardPath } from "@/lib/paths";

type ReplayAliasPageProps = {
  params: Promise<{ boardId: string }>;
};

export default async function ReplayAliasPage({ params }: ReplayAliasPageProps) {
  const resolvedParams = await params;
  const boardId = resolvedParams?.boardId ?? "";
  redirect(buildBroadcastBoardPath(boardId, "replay"));
}
