import type { Metadata } from "next";
import { NshLanding } from "@/components/landing/NshLanding";
import { NSH_VEHICLE_PAGES } from "@/lib/nsh-landing";

export const revalidate = 60;

const page = NSH_VEHICLE_PAGES.find((item) => item.path.endsWith("/na-manipulyator"))!;

export const metadata: Metadata = {
  title: page.title,
  description: page.description,
  alternates: { canonical: page.path },
};

export default function NshManipulyatorPage() {
  return <NshLanding page={page} />;
}
