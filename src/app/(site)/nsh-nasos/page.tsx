import type { Metadata } from "next";
import { NshLanding } from "@/components/landing/NshLanding";
import { NSH_HUB_PAGE } from "@/lib/nsh-landing";

export const revalidate = 60;

export const metadata: Metadata = {
  title: NSH_HUB_PAGE.title,
  description: NSH_HUB_PAGE.description,
  alternates: { canonical: NSH_HUB_PAGE.path },
};

export default function NshHubPage() {
  return <NshLanding page={NSH_HUB_PAGE} />;
}
