const { 
    Document, 
    Packer, 
    Paragraph, 
    TextRun, 
    Table, 
    TableRow, 
    TableCell, 
    AlignmentType, 
    ImageRun, 
    WidthType, 
    BorderStyle, 
    VerticalAlign,
    PageBreak,
    TableLayoutType
} = require('docx');
const fs = require('fs');
const path = require('path');

const PRIMARY_COLOR = '1e3a8a'; // Deep Navy
const ACCENT_COLOR = 'ef4444';  // Red
const GRAY_COLOR = '475569';
const BORDER_COLOR = 'cbd5e1';

function getLogoBuffer() {
    const candidates = [
        path.join(__dirname, '..', 'public', 'Chalo-on-tour.jpg.jpeg'),
        path.join(process.cwd(), 'public', 'Chalo-on-tour.jpg.jpeg'),
        path.join(__dirname, '..', '..', 'frontend', 'public', 'Chalo-on-tour.jpg.jpeg'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try { return fs.readFileSync(p); } catch (_) {}
        }
    }
    return null;
}

function parseLines(value) {
    if (!value || !String(value).trim()) return [];
    return String(value)
        .split(/\r?\n/)
        .map((item) => item.replace(/^[\s\u2022\-\u27A2]+/, '').trim())
        .filter(Boolean);
}

/**
 * "STABILITY FIRST" DOCX Generator
 * Uses Paragraphs for almost everything to prevent Word table collapsing.
 */
async function buildTourQuotationDocx(data) {
    const docChildren = [];
    const logoBuffer = getLogoBuffer();

    // ─── 1. HEADER (NO TABLES - COMPLETELY STABLE) ───
    if (logoBuffer) {
        docChildren.push(
            new Paragraph({
                children: [
                    new ImageRun({
                        data: logoBuffer,
                        transformation: { width: 140, height: 50 },
                    }),
                ],
                alignment: AlignmentType.CENTER,
            })
        );
    }
    
    docChildren.push(
        new Paragraph({
            children: [
                new TextRun({ text: "CHALO ON TOUR", bold: true, size: 28, color: PRIMARY_COLOR }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200 },
        }),
        new Paragraph({
            children: [
                new TextRun({ text: "THE FUTURE OF TRAVEL", bold: true, size: 12, color: GRAY_COLOR, characterSpacing: 2 }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
        }),
        new Paragraph({
            children: [
                new TextRun({ text: `Ph: ${data.cell1 || ''} / ${data.cell2 || ''} | Email: ${data.companyEmail || ''}`, size: 16 }),
            ],
            alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
            children: [
                new TextRun({ text: `Web: ${data.companyWebsite || ''}`, size: 16 }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
        })
    );

    // ─── 2. TITLE ───
    docChildren.push(
        new Paragraph({
            children: [
                new TextRun({ text: "TOUR DETAILS", bold: true, size: 36, color: PRIMARY_COLOR }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
        }),
        new Paragraph({
            children: [
                new TextRun({ text: `Quote: ${data.quoteNumber || '—'} | Date: ${data.quoteDate || '—'}`, size: 18, color: GRAY_COLOR }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
        })
    );

    // ─── 3. TRIP SUMMARY (USING PARAGRAPHS - NO SQUASHING) ───
    const tripTitleLabel = (data.packageName || '').trim() || (data.destinations || '').trim() || "Your Unique Trip";
    const tripTitle = `Exploration: ${tripTitleLabel}`;
    docChildren.push(
        new Paragraph({
            children: [new TextRun({ text: tripTitle, bold: true, size: 28 })],
            spacing: { after: 300, before: 400 },
            border: { bottom: { color: ACCENT_COLOR, size: 20, style: BorderStyle.SINGLE, space: 5 } }
        })
    );

    const summaryItems = [
        ["TOUR DURATION", data.tourDuration],
        ["TOTAL PAX", data.totalPax],
        ["MEAL PLAN", data.mealPlan],
        ["HOTEL CATEGORY", data.hotelCategory],
        ["VEHICLE TYPE", data.vehicleType],
        ["COST PER PERSON", data.perPersonCost ? `₹ ${Number(data.perPersonCost).toLocaleString('en-IN')}` : '—']
    ];

    summaryItems.forEach(([label, value]) => {
        docChildren.push(
            new Paragraph({
                children: [
                    new TextRun({ text: `${label}: `, bold: true, size: 20, color: PRIMARY_COLOR }),
                    new TextRun({ text: String(value || '—'), size: 20 }),
                ],
                spacing: { after: 100 },
                indent: { left: 400 }
            })
        );
    });

    // ─── 4. ACCOMMODATION (ONE ROW PER HOTEL - NO COMPRESSED COLUMNS) ───
    docChildren.push(
        new Paragraph({
            children: [new TextRun({ text: "ACCOMMODATION PLAN", bold: true, size: 24, color: PRIMARY_COLOR })],
            spacing: { before: 600, after: 300 },
            border: { bottom: { color: BORDER_COLOR, size: 10, style: BorderStyle.SINGLE, space: 5 } }
        })
    );

    const hotels = Array.isArray(data.hotels) ? data.hotels : [];
    hotels.forEach((h, i) => {
        docChildren.push(
            new Paragraph({
                children: [
                    new TextRun({ text: `STAY ${i + 1}: ${h?.destination || 'Destination'}`, bold: true, size: 20, color: PRIMARY_COLOR }),
                ],
                spacing: { before: 300, after: 100 }
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Hotel: ", bold: true, size: 18 }),
                    new TextRun({ text: h?.name || '—', size: 18 }),
                ],
                indent: { left: 400 },
                spacing: { after: 50 }
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Duration: ", bold: true, size: 18 }),
                    new TextRun({ text: `${h?.nights || '—'} Nights`, size: 18 }),
                ],
                indent: { left: 400 },
                spacing: { after: 50 }
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: "Room Category: ", bold: true, size: 18 }),
                    new TextRun({ text: h?.roomCategory || '—', size: 18 }),
                ],
                indent: { left: 400 },
                spacing: { after: 200 }
            })
        );
    });

    // ─── 5. ITINERARY ───
    docChildren.push(
        new Paragraph({
            children: [new TextRun({ text: "DETAILED ITINERARY", bold: true, size: 24, color: PRIMARY_COLOR })],
            spacing: { before: 600, after: 300 },
            border: { bottom: { color: BORDER_COLOR, size: 10, style: BorderStyle.SINGLE, space: 5 } }
        })
    );

    const itinerary = Array.isArray(data.itinerary) ? data.itinerary : [];
    itinerary.forEach((day, i) => {
        docChildren.push(
            new Paragraph({
                children: [
                    new TextRun({ text: `DAY ${i + 1}: ${day?.title || 'Tours'}`, bold: true, size: 22, color: PRIMARY_COLOR }),
                ],
                spacing: { before: 200, after: 100 },
            }),
            new Paragraph({
                children: [new TextRun({ text: day?.description || '', size: 20 })],
                spacing: { after: 150 },
            })
        );

        if (Array.isArray(day?.places) && day.places.filter(Boolean).length) {
            day.places.filter(Boolean).forEach(place => {
                docChildren.push(
                    new Paragraph({
                        text: place,
                        bullet: { level: 0 },
                        spacing: { after: 50 },
                    })
                );
            });
        }
    });

    // ─── 6. INCLUSIONS & EXCLUSIONS ───
    docChildren.push(new Paragraph({ children: [new PageBreak()] }));
    
    docChildren.push(
        new Paragraph({
            children: [new TextRun({ text: "WHAT'S INCLUDED", bold: true, size: 24, color: '16a34a' })],
            spacing: { after: 200 },
            border: { bottom: { color: '16a34a', size: 10, style: BorderStyle.SINGLE, space: 5 } }
        })
    );
    parseLines(data.inclusions).forEach(item => {
        docChildren.push(new Paragraph({ text: item, bullet: { level: 0 }, spacing: { after: 50 } }));
    });

    docChildren.push(
        new Paragraph({
            children: [new TextRun({ text: "WHAT'S NOT INCLUDED", bold: true, size: 24, color: ACCENT_COLOR })],
            spacing: { before: 400, after: 200 },
            border: { bottom: { color: ACCENT_COLOR, size: 10, style: BorderStyle.SINGLE, space: 5 } }
        })
    );
    parseLines(data.exclusions).forEach(item => {
        docChildren.push(new Paragraph({ text: item, bullet: { level: 0 }, spacing: { after: 50 } }));
    });

    // ─── 7. POLICIES ───
    docChildren.push(
        new Paragraph({
            children: [new TextRun({ text: "TERMS & POLICIES", bold: true, size: 24, color: PRIMARY_COLOR })],
            spacing: { before: 600, after: 300 },
            border: { bottom: { color: BORDER_COLOR, size: 10, style: BorderStyle.SINGLE, space: 5 } }
        })
    );
    
    docChildren.push(new Paragraph({ children: [new TextRun({ text: "Payment Schedule:", bold: true, size: 18, color: PRIMARY_COLOR })], spacing: { before: 200, after: 100 } }));
    parseLines(data.paymentPolicy).forEach(item => {
        docChildren.push(new Paragraph({ text: item, bullet: { level: 0 }, spacing: { after: 50 } }));
    });

    docChildren.push(new Paragraph({ children: [new TextRun({ text: "Cancellation Terms:", bold: true, size: 18, color: PRIMARY_COLOR })], spacing: { before: 200, after: 100 } }));
    parseLines(data.cancellationPolicy).forEach(item => {
        docChildren.push(new Paragraph({ text: item, bullet: { level: 0 }, spacing: { after: 50 } }));
    });

    // ─── 8. FOOTER ───
    docChildren.push(
        new Paragraph({ spacing: { before: 1000 } }),
        new Paragraph({
            children: [new TextRun({ text: "Thank you for choosing CHALO ON TOUR!", bold: true, color: PRIMARY_COLOR, size: 22 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 }
        }),
        new Paragraph({
            children: [new TextRun({ text: "www.chaloontour.com | THE FUTURE OF TRAVEL", size: 14, color: GRAY_COLOR, bold: true })],
            alignment: AlignmentType.CENTER,
        })
    );

    const doc = new Document({
        sections: [{
            properties: {},
            children: docChildren,
        }],
    });

    return await Packer.toBuffer(doc);
}

module.exports = { buildTourQuotationDocx };
