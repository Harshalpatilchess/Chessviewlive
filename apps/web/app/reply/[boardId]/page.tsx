import { redirect } from "next/navigation";
import { buildBroadcastBoardPath } from "@/lib/paths";

type ReplyAliasPageProps = {
  params: Promise<{ boardId: string }>;
};

export default async function ReplyAliasPage({ params }: ReplyAliasPageProps) {
  const resolvedParams = await params;
  const boardId = resolvedParams?.boardId ?? "";
  redirect(buildBroadcastBoardPath(boardId, "replay"));
}
