# Project Brief

## Project type

Website catalog with admin panel for spare parts and equipment for special machinery.

This is not an ecommerce store. There is no cart, online payment, or checkout in the first version.

## Goal

The website should let users open the site, quickly understand what the company offers, browse categories, search products, filter products, open product pages, and view product information.

## Audience

Private individuals and small companies who use, repair, rent, or maintain special machinery and trucks.

The audience processes information visually, so the interface must be simple, clear, visual, and easy to scan.

## Visual style

Minimalistic, clean, practical, modern.

Main colors:
- white
- blue

The client company logo uses blue and white, so the website palette should be based on those colors.

The design should be pleasant, but not overloaded. The main goal is usability and fast access to catalog sections.

## Reference

The client likes the general direction of this website:
https://hyva.com.ua/ru/

Do not copy it directly. Use it only as a reference for structure, catalog logic, product/category presentation, and clean industrial style.

## Main page structure

The homepage must be short. Do not create a long landing page.

Homepage sections:

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

The catalog must support from 10,000 to 40,000 products in the future.

Do not load all products on the frontend.

Use:
- server-side pagination
- backend filtering
- backend search
- optimized images
- product import from CSV/Excel in the admin panel later

## Product card

Product card should show:

- Image
- Product name
- Short description
- Approximate price
- Category
- Brand
- Details button

No availability status in the first version.

No WhatsApp button in the first version.

## Product page

Product page should show:

- Image gallery
- Product title
- Approximate price
- Description
- Characteristics
- Category
- Compatible brands
- Similar products

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

First version:
- normal search by name, article, brand, category

Later version:
- smart search
- typo tolerance
- possible AI search

Do not implement AI search in the first version.

## First development goal

Build the frontend structure first using mock data.

Do not connect the database yet.

Create clean reusable components, mock product data, category data, and brand data.

Use Next.js App Router, TypeScript, Tailwind CSS.