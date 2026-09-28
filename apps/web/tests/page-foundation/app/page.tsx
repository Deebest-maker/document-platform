import { notFound } from "next/navigation";
import { Consumer } from "./consumer";
export const dynamic = "force-dynamic";
export default function Page() {
  if (process.env.PDF_FOUNDATION_TEST !== "1") notFound();
  return <Consumer />;
}
