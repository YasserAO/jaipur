import "./globals.css";

export const metadata = {
  title: "Jaipur",
  description: "Realtime Jaipur game with Express + PixiJS"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
