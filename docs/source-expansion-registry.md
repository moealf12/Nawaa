# NAWAA Source Expansion Registry — 2026-10-03

Goal: maximize price-discovery coverage for Saudi buyers. A store is not "integrated" until a live adapter/API/feed is implemented and audited. This registry is the acquisition backlog.

## P0 Saudi / Saudi-facing
Amazon.sa
Noon Saudi
Jarir
eXtra
Carrefour Saudi
LuLu Saudi
Panda / HyperPanda
Danube
BinDawood
Tamimi Markets
Othaim Markets
SACO
IKEA Saudi
Virgin Megastore Saudi
Aleph
Samsung Saudi
Huawei Saudi
Xiaomi Saudi
Sharaf DG Saudi
Axiom Telecom
Microless Saudi
Revibe
Jomla
Namshi
Ounass
6thStreet
Centrepoint
Max Fashion
H&M Saudi
Zara Saudi
Mango Saudi
Nike Saudi
Adidas Saudi
Puma Saudi
New Balance Saudi
Sun & Sand Sports
Decathlon Saudi
SHEIN Saudi
Trendyol Saudi
Nice One
Golden Scent
Sephora Saudi
Faces
Nahdi
Al-Dawaa
Whites
iHerb
Mumzworld
Mothercare
Toys R Us / regional storefront where available
Home Centre
Home Box
Almanea
Black Box
Alsaif Gallery
Floward
Swarovski Saudi
Pandora Saudi

## P1 Global / cross-border
eBay
AliExpress
Temu
Amazon US
Amazon UK
Amazon Germany
Amazon UAE
Walmart
Target
Best Buy
B&H Photo
Newegg
Etsy
ASOS
Farfetch
SSENSE
Net-a-Porter
Mr Porter
Mytheresa
END.
Selfridges
Harrods
Zalando
Uniqlo
StockX
GOAT
Jomashop
FragranceX
FragranceNet
Lookfantastic
Cult Beauty
Stylevana
YesStyle
Geekbuying
Banggood
Alibaba

## Integration acceptance gate
For each source record: source id, country, categories, acquisition method, ToS/robots review, live-search capability, canonical product URL, title, image, current price, original price when present, currency, stock, variant/SKU/GTIN/MPN where exposed, shipping-to-SA evidence, shipping cost, observedAt, and audit status.

Statuses: DISCOVERED -> PROBED -> ADAPTER_BUILT -> LIVE_VALIDATED -> PRODUCTION.
Never label DISCOVERED/PROBED as a working NAWAA source.
