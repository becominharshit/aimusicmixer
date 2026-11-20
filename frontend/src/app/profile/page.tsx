import type { Metadata } from "next";
import { ProfileView } from "@/components/profile/ProfileView";

export const metadata: Metadata = {
  title: "Mixit Profile — Studio Preferences & Privacy",
  description:
    "Manage your Mixit studio profile, default genre, preferred DAW, INK/PAPER theme, and three-tier AI privacy preferences.",
};

export default function ProfilePage() {
  return <ProfileView />;
}
