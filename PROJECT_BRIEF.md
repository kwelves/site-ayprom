# Project Brief

## How to use this brief

This brief is a living product direction, not a rigid implementation script. New client feedback, real catalog data, usability findings, and stronger design ideas may change the current direction.

The fixed product constraints are:

- the site is a catalog, not an ecommerce checkout
- prices are not shown in the first version
- catalog data and administrative access must remain secure

Other sections describe the current direction. The designer or AI may challenge them, propose alternatives, and explain tradeoffs. When the desired result is unclear, present two or three viable options and recommend one before making a major directional change.

## Project type

Website catalog with admin panel for spare parts and equipment for special machinery.

This is not an ecommerce store. There is no cart, online payment, or checkout in the first version.

## Goal

The website should let customers quickly understand what the company offers, browse categories, search products, open product pages, and contact the company.

Search is the primary way to narrow down products. The current design does not require a conventional filter sidebar, but lightweight filter-like controls may be added when real data or customer behavior shows a clear need.

## Audience

The audience includes private owners, small and medium-sized companies, mechanics, drivers, operators, and other working people who use, repair, rent, or maintain special machinery and trucks.

For many customers, working machinery is the source of income that supports their family. They need to find the right part without wasting working time or decoding technical marketing language.

The audience processes information visually, so the interface should be clear, practical, visual, and easy to scan.

## Visual style

Minimalistic, clean, practical, modern.

Main colors:
- white
- blue

The client company logo uses blue and white, so the website palette should be based on those colors.

The design should be pleasant, but not overloaded. The main goal is usability and fast access to catalog sections.

## Media quality

Quality has priority for every production photo, video, logo, and illustration.

- Raster photos and videos must use an ultra-high-quality or high-quality master
  with a resolution of at least 2K, preferably 4K.
- If the best available raster source is below 2K, upscale it before production
  use and inspect the result for blur, halos, noise, distorted text, and
  artificial details.
- Do not upscale or rasterize SVG files. A true SVG has no pixel-resolution
  limit and must remain vector-based, with a correct `viewBox`, intact paths,
  and no embedded low-resolution raster image.
- Do not reduce resolution or compression quality merely to satisfy an
  arbitrary file-size target. When performance matters, create responsive
  derivatives from the retained high-resolution master and verify their visual
  quality on the target screen.

## Reference

The client strongly likes how this website looks and considers it the main visual reference:
https://hyva.com.ua/ru/

Do not copy it directly. Study what the client likes about its visual hierarchy, catalog logic, product and category presentation, spacing, and industrial character. Propose ways to adapt those qualities to AYPROM.

## Main page structure

The homepage should feel focused and reasonably compact, but it has no strict length limit. Add a section when it helps customers choose a product, trust the company, or contact it. Remove sections that repeat information or exist only to make the page longer.

The current homepage structure is:

1. Header
2. Hero section
3. Catalog by product type
4. Catalog by machinery brand
5. About section
6. Partners section
7. Footer with visible contacts and address

The “All products” button must be placed in the header.

## Header

Header should contain:

- Logo
- Catalog
- Brands
- About
- Contacts
- All products button

The “All products” button should lead to `/catalog`.

## Hero section

Hero should contain:

- Main title
- Short subtitle
- Search input
- Primary button to catalog
- Secondary button to brands or categories
- Visual image/illustration related to special machinery or spare parts

Example direction:

Title:
Catalog of spare parts and equipment for special machinery

Subtitle:
Find the right part by product type, machinery brand, name, or article number.

## Catalog by product type

Show visual category cards.

Example categories:
- Gear pumps
- Piston pumps
- PTO
- Valves
- Hydraulic cylinders
- Filters
- Components

Each card should link to a filtered catalog page.

## Catalog by machinery brand

Show brand cards.

Example brands:
- HOWO
- Shacman
- FAW
- Sitrak
- Dongfeng
- Other brands

Each brand should link to a filtered catalog page.

## About section

Short section only. No long marketing text.

The section should explain that the company helps customers find parts and equipment for special machinery and trucks.

## Partners section

Small compact section with partner or brand logos.

If there are no real partner logos yet, use placeholder brand cards.

## Footer

Footer should be visually noticeable, not just small text.

Footer should include:

- Logo
- Short company description
- Navigation
- Address
- Phone
- Email
- Working hours

Contacts must be easy to see.

## WhatsApp contact badge

The site should include a small circular WhatsApp badge fixed to the bottom-right corner. Clicking it should open the company chat directly.

The badge should remain noticeable without covering content or competing with the main catalog actions. It needs an accessible label, a comfortable touch target, and spacing for mobile safe areas. On product pages, a later iteration may include the product name and article in the initial message.

## Pages

Required public pages:

- `/`
- `/catalog`
- `/catalog/category/[slug]`
- `/catalog/brand/[slug]`
- `/product/[slug]`
- `/about`
- `/contacts`

Required admin pages later:

- `/admin`
- `/admin/products`
- `/admin/products/new`
- `/admin/products/[id]`
- `/admin/categories`
- `/admin/brands`
- `/admin/import`

## Catalog requirements

The catalog should support approximately 2,000 products.

Do not load all products on the frontend.

Backend pagination means the browser requests one page at a time, for example 24 products. The database returns only that page instead of sending the full catalog to the browser.

Use:
- backend pagination
- backend search as the primary narrowing tool
- optimized images
- product import from CSV/Excel in the admin panel later

## Product card

Product card should show:

- Image
- Product name
- Short description
- Category
- Brand
- Details button

No price in the first version — this is not an ecommerce store, and pricing is not part of the catalog's job.

No availability status in the first version.

## Product page

Product page should show:

- Image gallery
- Product title
- Description
- Characteristics
- Category
- Compatible brands
- Similar products

No price shown anywhere in the first version (see "Product card").

## Admin panel

Admin panel should eventually allow:

- login
- adding products
- editing products
- deleting products
- publishing/unpublishing products
- uploading multiple images
- managing categories
- managing brands
- importing products from CSV/Excel
- managing admin users or employees

## Search

Search is the primary way to narrow down products, so it needs to cover more ground than a typical first-version search.

A conventional filter sidebar is not required. Small filter-like controls, suggestions, or shortcuts may be introduced later when they solve a verified customer problem and do not overload the interface.

First version — plain (non-AI) search, but across more fields than just the basics:
- name, article, brand, category
- product characteristics/attribute values (see "Product page")

Later version:
- typo tolerance
- possible AI/semantic search

Do not implement AI search in the first version.

## Current development state

The frontend structure has been approved and the project is connected to Supabase.

Supabase is the source of truth for catalog data. Production pages must not fall back to hardcoded
mock catalog data. Mock data and generated fixtures may be used only in isolated tests, local
development, and performance checks.

Database schema changes must be tracked as versioned SQL migrations in `supabase/migrations`,
reviewed and tested locally before they are applied to a remote project. Public reads must use the
publishable key and remain protected by RLS. Secret/service-role keys must be used only in
server-side code.

Continue using Next.js App Router, TypeScript, Tailwind CSS, and clean reusable components.
