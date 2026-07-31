import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multi Video Player",
  description:
    "Play local videos side by side on one synchronized timeline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
