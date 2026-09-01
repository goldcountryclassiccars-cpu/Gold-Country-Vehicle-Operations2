# Project Notes — Gold Country Classic Cars

## Business

Gold Country Classic Cars is a boutique classic and collector car dealership located in
Grass Valley, California. Website: https://www.goldcountryclassiccars.com

### Owners

- **Sergio Edell** — finding and acquiring vehicles, evaluating acquisition opportunities,
  working with sellers and consignors, pricing decisions, sales, buyer negotiations.
- **Jade Southworth** — business operations, marketing, processes and systems, reporting,
  technology, AI implementation, administrative workflows.

Both owners must have complete access to the application.

### Deal types

The dealership handles both **dealer-owned vehicles** and **consignment vehicles**.
Consignment is a major part of the business. The system must never assume that every
vehicle is owned by the dealership.

### Acquisition sources

Vehicles are acquired through: Google PPC campaigns directed at vehicle sellers, website
inquiries, print advertising, word of mouth, repeat sellers, referrals, local car clubs,
car shows and automotive events, direct outreach, and auctions or other sources when
applicable. Acquisition-source data is retained so management can determine which sources
produce the most valuable and profitable vehicles.

## Current website and future systems

The dealership currently uses CarsForSale.com for its website, listings, and some basic
dealership functionality. A custom website is under consideration for greater control over
SEO, site functionality, vehicle presentation, data ownership, integrations, lead
generation, reporting, and automation.

A separate **listing creation and listing propagation application** is planned. The vehicle
operations application (this system) must be capable of communicating with it.

### Authority split

This operations application is the authoritative source for: vehicle identity,
specifications, inspection information, work completed, known problems and disclosures,
approved price, media readiness, current availability, and sold status.

The future listing application will be responsible for: creating listing descriptions,
platform-specific copy, publishing to the dealership website / marketplaces / social media,
tracking publication results, and recording listing URLs and external listing IDs.

The two applications share stable internal vehicle and inventory-episode identifiers.

## Business objective

Gold Country Classic Cars is implementing AI and custom software systems to: generate more
revenue, find more desirable vehicles, improve profitability, reduce administrative work,
eliminate duplicate data entry, improve internal communication, shorten vehicle
preparation time, improve reporting, preserve historical vehicle and transaction data,
make better acquisition and pricing decisions, and provide a better buyer and consignor
experience.

## Product vision

A vehicle-centric operations platform managing a vehicle from initial acquisition or
consignment through: expected arrival, physical intake, detailing, mechanical inspection,
mechanical work, body and paint work, quality control, photography and video, listing
preparation, listing publication, active inventory, buyer agreement, deposit and payment,
sales documents, title and registration workflow, transportation or buyer pickup,
consignor settlement (when applicable), financial closing, and a permanent sold-vehicle
archive.

The system is a vehicle operations system, workflow system, internal communication system,
deal-closing system, vehicle expense ledger, profitability system, document archive, and
management reporting platform — the operational source of truth for every vehicle.

## Non-negotiable UX and permissions principle

Owners see everything. Other users see only the information, navigation, screens, fields,
records, and actions relevant to their jobs — implemented as genuine server-enforced
authorization, not hidden menu items. See `PERMISSIONS.md`.
