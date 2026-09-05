// Starting points shown in the "New page" dialog. Plain HTML + CSS only, so
// they render identically in the editor and in any browser.
'use strict';

const HE_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank page',
    description: 'An empty page with a clean default style.',
    accent: '#64748b',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My page</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1f2937; max-width: 820px; margin: 0 auto; padding: 40px 24px; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
</style>
</head>
<body>
<h1>Welcome to your new page</h1>
<p>Click anywhere on this text and start typing. Use the panel on the left to add headings, images, buttons and more.</p>
</body>
</html>
`,
  },
  {
    id: 'landing',
    name: 'Landing page',
    description: 'Hero section, three features and a call to action.',
    accent: '#2563eb',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Product name — Landing page</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111827; line-height: 1.6; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 20px 6%; }
  header .logo { font-weight: 800; font-size: 20px; color: #2563eb; }
  header nav a { margin-left: 24px; color: #374151; text-decoration: none; font-weight: 500; }
  .hero { text-align: center; padding: 80px 6% 60px; background: linear-gradient(180deg, #eff6ff, #ffffff); }
  .hero h1 { font-size: 48px; line-height: 1.15; margin: 0 0 16px; }
  .hero p { font-size: 20px; color: #4b5563; max-width: 640px; margin: 0 auto 32px; }
  .btn { display: inline-block; padding: 14px 28px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; }
  .btn.secondary { background: #e5e7eb; color: #111827; margin-left: 12px; }
  .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; padding: 60px 6%; }
  .feature { padding: 28px; border: 1px solid #e5e7eb; border-radius: 12px; }
  .feature h3 { margin-top: 0; }
  .cta { text-align: center; padding: 60px 6%; background: #111827; color: #fff; }
  .cta h2 { font-size: 32px; margin: 0 0 12px; }
  footer { padding: 24px 6%; text-align: center; color: #6b7280; font-size: 14px; }
  img { max-width: 100%; height: auto; }
  @media (max-width: 720px) { .features { grid-template-columns: 1fr; } .hero h1 { font-size: 34px; } }
</style>
</head>
<body>
<header>
  <div class="logo">Brand</div>
  <nav><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#contact">Contact</a></nav>
</header>
<section class="hero">
  <h1>A clear headline about your product</h1>
  <p>One or two sentences that explain what you offer and why it matters to your visitors.</p>
  <a class="btn" href="#">Get started</a><a class="btn secondary" href="#">Learn more</a>
</section>
<section class="features" id="features">
  <div class="feature"><h3>Feature one</h3><p>Describe a benefit your customers care about in a couple of sentences.</p></div>
  <div class="feature"><h3>Feature two</h3><p>Describe a benefit your customers care about in a couple of sentences.</p></div>
  <div class="feature"><h3>Feature three</h3><p>Describe a benefit your customers care about in a couple of sentences.</p></div>
</section>
<section class="cta" id="pricing">
  <h2>Ready to get started?</h2>
  <p>Join thousands of happy customers today.</p>
  <a class="btn" href="#">Sign up for free</a>
</section>
<footer id="contact">© 2026 Brand. All rights reserved. · hello@example.com</footer>
</body>
</html>
`,
  },
  {
    id: 'article',
    name: 'Blog article',
    description: 'A readable long-form article layout.',
    accent: '#059669',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Article title</title>
<style>
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #1f2937; background: #fafaf9; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px; background: #fff; }
  h1 { font-size: 40px; line-height: 1.2; margin: 0 0 8px; }
  .meta { color: #6b7280; font-family: system-ui, sans-serif; font-size: 14px; margin-bottom: 32px; }
  p { font-size: 19px; line-height: 1.75; }
  h2 { margin-top: 40px; }
  blockquote { border-left: 4px solid #059669; margin: 24px 0; padding: 8px 20px; color: #374151; font-style: italic; background: #f0fdf4; }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  a { color: #059669; }
</style>
</head>
<body>
<article class="wrap">
  <h1>Your article title goes here</h1>
  <div class="meta">By Author Name · September 2026 · 5 min read</div>
  <p>Start with an opening paragraph that draws the reader in. Explain what the article is about and why it is worth reading.</p>
  <h2>First section</h2>
  <p>Add your content here. Click on any text to edit it. You can insert images, quotes and lists from the Blocks panel.</p>
  <blockquote>“A memorable quote that supports your point.”</blockquote>
  <h2>Second section</h2>
  <p>Continue your story. Use headings to break the article into easy-to-scan sections.</p>
  <ul>
    <li>A key takeaway</li>
    <li>Another key takeaway</li>
    <li>One more thing to remember</li>
  </ul>
  <p>Wrap up with a conclusion and, if you like, a link to <a href="#">something related</a>.</p>
</article>
</body>
</html>
`,
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Introduce yourself and show off your work.',
    accent: '#d946ef',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your Name — Portfolio</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #18181b; background: #fff; line-height: 1.6; }
  .intro { padding: 80px 8% 40px; max-width: 1100px; margin: 0 auto; }
  .intro h1 { font-size: 52px; margin: 0 0 12px; letter-spacing: -0.02em; }
  .intro h1 span { color: #d946ef; }
  .intro p { font-size: 20px; color: #52525b; max-width: 600px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px; padding: 20px 8% 60px; max-width: 1100px; margin: 0 auto; }
  .card { border-radius: 14px; overflow: hidden; background: #fafafa; border: 1px solid #e4e4e7; }
  .card .thumb { height: 180px; background: linear-gradient(135deg, #f0abfc, #818cf8); }
  .card .body { padding: 18px; }
  .card h3 { margin: 0 0 6px; }
  .card p { margin: 0; color: #52525b; font-size: 15px; }
  .contact { text-align: center; padding: 60px 8%; background: #18181b; color: #fff; }
  .contact a { color: #f0abfc; }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>
<section class="intro">
  <h1>Hi, I'm <span>Your Name</span>.</h1>
  <p>I'm a designer / photographer / developer based in Your City. Here is a selection of my recent work.</p>
</section>
<section class="grid">
  <div class="card"><div class="thumb"></div><div class="body"><h3>Project one</h3><p>A short description of the project.</p></div></div>
  <div class="card"><div class="thumb"></div><div class="body"><h3>Project two</h3><p>A short description of the project.</p></div></div>
  <div class="card"><div class="thumb"></div><div class="body"><h3>Project three</h3><p>A short description of the project.</p></div></div>
</section>
<section class="contact">
  <h2>Let's work together</h2>
  <p>Email me at <a href="mailto:you@example.com">you@example.com</a></p>
</section>
</body>
</html>
`,
  },
];
