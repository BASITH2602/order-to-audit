# Demo script (about 7 minutes)

Run `docker compose --env-file .env.benchmark up --build`. Password for all users: `Benchmark@2026`.
Use two browser windows: a narrow one (phone view) for salesmen and a wide one for admin/production.

1. **Production login → Receive material.** Supplier Demo Flour Mills, any bill number, Flour 60 kg at ₹45. Open the Stock tab: flour 160 kg.
2. **Production run tab.** Murukku 200 g, 1 batch. Set oil 10.5. Good packets 188, damaged 6, click *Pouches = good + damaged* (194), cartons 9. Save run.
3. **Show the result table:** yield −6% flagged, oil +5% flagged, cartons −10% flagged. Stock tab: flour 120 kg, oil 19.5 L, pouches 306, finished goods 238.
4. **Phone window, `salesman_a`:** Retailer A, 150 packets, submit. Mention the offline queue (switch the browser to offline, submit, go back online).
5. **Admin window:** the order appears instantly with "stock covers this order". Approve → Raise GST invoice (₹7,500 + ₹187.50 + ₹187.50 = ₹7,875) → open the PDF → Record dispatch. Stock: finished goods 88.
6. **Phone window, `salesman_b`:** Distributor B, 120 packets. **Admin:** red banner "short by 32"; Approve is refused. Edit quantity to 88, approve, raise invoice: IGST ₹220 (Karnataka).
7. **Admin:** on Retailer A's invoice, Record payment ₹4,000 UPI. Receivables tab: ₹3,875.
8. **Production window:** open the run, enter labour ₹1,200 and gas/power ₹600, save. Cost per packet ₹31.14, margin 37.71%. Explain: weighted-average materials on actual use, overheads spread over good packets.
9. **Reports:** sales register, GST summary, stock ledger, production variance, ageing. Export one to Excel and one to PDF.
10. **Owner login:** dashboard with orders, dues, variance alert and cost per packet. Close by showing the stock ledger lines pointing to their source documents.
