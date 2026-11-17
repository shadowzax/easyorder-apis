const express = require("express");
const router = express.Router();
const { db } = require("../../mydb/restaurants");

router.get("/", (req, res) => {
    db.all(
        "SELECT * FROM restaurants ORDER BY created_at DESC",
        [],
        (err, restaurants) => {
            if (err) {
                console.error("Restaurants DB Error:", err);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            res.json({
                success: true,
                count: restaurants.length,
                restaurants
            });
        }
    );
});
router.get("/add-menu", (req, res) => {
    const menu = [
    {
      "id": 1,
      "name_ar": "مقبلات",
      "name_en": "Appetizers",
      "name_ru": "",
      "items": [
        {
          "id": 1,
          "name_ar": "خبز بلدي",
          "description_ar": "خبز طازج من الفرن البلدي",
          "price": 5,
          "image": "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=300",
          "is_available": true,
          "options": [
            {
              "title": "النوع",
              "required": true,
              "multi": false,
              "items": [
                { "name": "بلدي", "price": 0 },
                { "name": "شامي", "price": 2 },
                { "name": "فينو", "price": 3 }
              ]
            },
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "صغير", "price": 0 },
                { "name": "كبير", "price": 3 }
              ]
            }
          ]
        },
        {
          "id": 2,
          "name_ar": "حمص",
          "description_ar": "حمص كريمي مع زيت الزيتون والطحينة",
          "price": 15,
          "image": "https://images.unsplash.com/photo-1547058881-aa0edd92aab3?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 8 }
              ]
            },
            {
              "title": "النوع",
              "required": true,
              "multi": false,
              "items": [
                { "name": "عادي", "price": 0 },
                { "name": "بالشطة", "price": 0 },
                { "name": "بالحمص الكامل", "price": 3 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "زيت زيتون إضافي", "price": 3 },
                { "name": "ليمون إضافي", "price": 2 },
                { "name": "صنوبر", "price": 10 }
              ]
            }
          ]
        },
        {
          "id": 3,
          "name_ar": "باذنجان مشوي",
          "description_ar": "باذنجان مشوي مع الطماطم والثوم",
          "price": 18,
          "image": "https://images.unsplash.com/photo-1625943553852-781c6dd46faa?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 7 }
              ]
            },
            {
              "title": "النوع",
              "required": true,
              "multi": false,
              "items": [
                { "name": "مشوي", "price": 0 },
                { "name": "مقلي", "price": 0 },
                { "name": "بابا غنوج", "price": 4 }
              ]
            }
          ]
        },
        {
          "id": 4,
          "name_ar": "سلطة خضراء",
          "description_ar": "خضروات طازجة مع صوص الليمون",
          "price": 20,
          "image": "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 10 }
              ]
            },
            {
              "title": "الصوص",
              "required": true,
              "multi": false,
              "items": [
                { "name": "ليمون وزيت", "price": 0 },
                { "name": "طحينة", "price": 3 },
                { "name": "مايونيز", "price": 4 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": 2,
      "name_ar": "ساندويتشات",
      "name_en": "Sandwiches",
      "name_ru": "",
      "items": [
        {
          "id": 5,
          "name_ar": "ساندويتش جمبري",
          "description_ar": "جمبري مقرمش مع الخس والطماطم والصوص الخاص",
          "price": 65,
          "image": "https://images.unsplash.com/photo-1550507992-eb63ffee0847?w=300",
          "is_available": true,
          "options": [
            {
              "title": "نوع الخبز",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فينو", "price": 0 },
                { "name": "شامي", "price": 3 },
                { "name": "صاج", "price": 5 }
              ]
            },
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "عادي", "price": 0 },
                { "name": "دبل", "price": 25 }
              ]
            },
            {
              "title": "الصوص",
              "required": false,
              "multi": true,
              "items": [
                { "name": "ثومية", "price": 0 },
                { "name": "صوص حار", "price": 3 },
                { "name": "مايونيز", "price": 3 }
              ]
            }
          ]
        },
        {
          "id": 6,
          "name_ar": "ساندويتش كابوريا",
          "description_ar": "لحم كابوريا مع الخضروات وصوص المطعم",
          "price": 75,
          "image": "https://images.unsplash.com/photo-1521390188846-e2a2a9744e8a?w=300",
          "is_available": true,
          "options": [
            {
              "title": "نوع الخبز",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فينو", "price": 0 },
                { "name": "شامي", "price": 3 },
                { "name": "صاج", "price": 5 }
              ]
            },
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "عادي", "price": 0 },
                { "name": "دبل", "price": 30 }
              ]
            }
          ]
        },
        {
          "id": 7,
          "name_ar": "ساندويتش فيليه سمك",
          "description_ar": "فيليه سمك مقرمش مع الخس والطماطم والجبنة",
          "price": 55,
          "image": "https://images.unsplash.com/photo-1547592180-85f173990554?w=300",
          "is_available": true,
          "options": [
            {
              "title": "طريقة التحضير",
              "required": true,
              "multi": false,
              "items": [
                { "name": "مقلي", "price": 0 },
                { "name": "مشوي", "price": 5 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "جبنة", "price": 8 },
                { "name": "بطاطس", "price": 10 },
                { "name": "صوص حار", "price": 3 }
              ]
            }
          ]
        },
        {
          "id": 8,
          "name_ar": "ساندويتش كاليماري",
          "description_ar": "حلقات كاليماري مقرمشة مع الخضروات وصوص الثوم",
          "price": 60,
          "image": "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=300",
          "is_available": true,
          "options": [
            {
              "title": "طريقة التحضير",
              "required": true,
              "multi": false,
              "items": [
                { "name": "مقلي", "price": 0 },
                { "name": "مشوي", "price": 10 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "صوص الثوم", "price": 4 },
                { "name": "صوص حار", "price": 4 },
                { "name": "ليمون", "price": 2 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": 3,
      "name_ar": "بحريات",
      "name_en": "Seafood",
      "name_ru": "",
      "items": [
        {
          "id": 9,
          "name_ar": "سمك مشوي",
          "description_ar": "سمك طازج مشوي على الفحم مع الأرز",
          "price": 85,
          "image": "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=300",
          "is_available": true,
          "options": [
            {
              "title": "نوع السمك",
              "required": true,
              "multi": false,
              "items": [
                { "name": "هامور", "price": 0 },
                { "name": "كنعد", "price": 15 },
                { "name": "شعري", "price": 10 },
                { "name": "دنيس", "price": 20 },
                { "name": "بلطي", "price": -10 },
                { "name": "بوري", "price": 5 }
              ]
            },
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 25 }
              ]
            },
            {
              "title": "طريقة التسوية",
              "required": true,
              "multi": false,
              "items": [
                { "name": "مشوي", "price": 0 },
                { "name": "مقلي مفتوح بطن", "price": 0 },
                { "name": "مقلي مقفول بطن", "price": 0 },
                { "name": "زيت ولمون", "price": 0 },
                { "name": "رده مشوي", "price": 5 },
                { "name": "بالفرن", "price": 0 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "أرز بسمتي", "price": 12 },
                { "name": "أرز صيادية", "price": 15 },
                { "name": "طبق رز كبير", "price": 25 },
                { "name": "طبق رز صغير", "price": 15 },
                { "name": "سلطة خضراء", "price": 8 },
                { "name": "طحينة", "price": 4 },
                { "name": "صوص حار", "price": 3 },
                { "name": "ليمون إضافي", "price": 2 }
              ]
            }
          ]
        },
        {
          "id": 10,
          "name_ar": "جمبري مقلي",
          "description_ar": "جمبري طازج مقرمش مع صوص خاص",
          "price": 120,
          "image": "https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "نصف كيلو", "price": 0 },
                { "name": "كيلو", "price": 90 }
              ]
            },
            {
              "title": "طريقة التحضير",
              "required": true,
              "multi": false,
              "items": [
                { "name": "مقلي مقرمش", "price": 0 },
                { "name": "مشوي", "price": 10 },
                { "name": "زيت ولمون", "price": 5 },
                { "name": "بالثوم والزبدة", "price": 15 }
              ]
            },
            {
              "title": "الصوص",
              "required": false,
              "multi": true,
              "items": [
                { "name": "صوص الثوم", "price": 4 },
                { "name": "صوص حار", "price": 4 },
                { "name": "مايونيز", "price": 4 },
                { "name": "ليمون إضافي", "price": 2 }
              ]
            }
          ]
        },
        {
          "id": 11,
          "name_ar": "كاليماري مقرمش",
          "description_ar": "حلقات كاليماري مقرمشة مع صوص الثوم",
          "price": 95,
          "image": "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=300",
          "is_available": false,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "نصف كيلو", "price": 0 },
                { "name": "كيلو", "price": 80 }
              ]
            },
            {
              "title": "طريقة التحضير",
              "required": true,
              "multi": false,
              "items": [
                { "name": "مقلي", "price": 0 },
                { "name": "مشوي", "price": 10 },
                { "name": "زيت ولمون", "price": 5 }
              ]
            },
            {
              "title": "الصوص",
              "required": false,
              "multi": true,
              "items": [
                { "name": "صوص الثوم", "price": 4 },
                { "name": "صوص حار", "price": 4 },
                { "name": "تارتار", "price": 5 }
              ]
            }
          ]
        },
        {
          "id": 12,
          "name_ar": "فيلية سمك",
          "description_ar": "شرائح سمك فيليه طازجة مع الأرز والسلطة",
          "price": 95,
          "image": "https://images.unsplash.com/photo-1534766555764-ce878a5e3a2b?w=300",
          "is_available": true,
          "options": [
            {
              "title": "طريقة التحضير",
              "required": true,
              "multi": false,
              "items": [
                { "name": "مشوي", "price": 0 },
                { "name": "مقلي", "price": 0 },
                { "name": "بالفرن", "price": 5 }
              ]
            },
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 30 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "أرز بسمتي", "price": 12 },
                { "name": "أرز صيادية", "price": 15 },
                { "name": "بطاطس", "price": 10 },
                { "name": "طحينة", "price": 4 }
              ]
            }
          ]
        },
        {
          "id": 13,
          "name_ar": "طاجن جمبري",
          "description_ar": "جمبري مع الخضروات والصوص الخاص داخل طاجن",
          "price": 140,
          "image": "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فردي", "price": 0 },
                { "name": "عائلي", "price": 100 }
              ]
            },
            {
              "title": "الإضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "جبنة", "price": 15 },
                { "name": "مشروم", "price": 10 },
                { "name": "فلفل حار", "price": 5 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": 4,
      "name_ar": "مشويات",
      "name_en": "Grills",
      "name_ru": "",
      "items": [
        {
          "id": 14,
          "name_ar": "مشويات مشكلة",
          "description_ar": "تشكيلة مشويات مشكلة مع الأرز والسلطة",
          "price": 150,
          "image": "https://images.unsplash.com/photo-1544025162-d76694265947?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فردي", "price": 0 },
                { "name": "مزدوج", "price": 80 },
                { "name": "عائلي", "price": 180 }
              ]
            },
            {
              "title": "النوع",
              "required": true,
              "multi": true,
              "items": [
                { "name": "كباب", "price": 0 },
                { "name": "كفتة", "price": 0 },
                { "name": "شيش طاووق", "price": 0 },
                { "name": "ريش ضاني", "price": 30 },
                { "name": "فرخة مشوية", "price": 20 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "طبق رز كبير", "price": 25 },
                { "name": "طبق رز صغير", "price": 15 },
                { "name": "سلطة خضراء", "price": 8 },
                { "name": "طحينة", "price": 4 },
                { "name": "خبز إضافي", "price": 5 }
              ]
            }
          ]
        },
        {
          "id": 15,
          "name_ar": "كباب مشوي",
          "description_ar": "قطع لحم متبلة ومشوية على الفحم",
          "price": 130,
          "image": "https://images.unsplash.com/photo-1558030006-450675393462?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "عادي", "price": 0 },
                { "name": "كبير", "price": 40 }
              ]
            },
            {
              "title": "درجة التسوية",
              "required": true,
              "multi": false,
              "items": [
                { "name": "متوسط", "price": 0 },
                { "name": "جيد", "price": 0 },
                { "name": "جيد جداً", "price": 0 }
              ]
            }
          ]
        },
        {
          "id": 16,
          "name_ar": "كفتة",
          "description_ar": "كفتة لحم متبلة ومشوية على الفحم",
          "price": 110,
          "image": "https://images.unsplash.com/photo-1529042410759-befb1204b468?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "عادي", "price": 0 },
                { "name": "كبير", "price": 35 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "طحينة", "price": 4 },
                { "name": "بطاطس", "price": 10 },
                { "name": "أرز", "price": 15 }
              ]
            }
          ]
        },
        {
          "id": 17,
          "name_ar": "شيش طاووق",
          "description_ar": "قطع دجاج متبلة ومشوية مع الخضروات",
          "price": 100,
          "image": "https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "عادي", "price": 0 },
                { "name": "كبير", "price": 30 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "جبنة", "price": 8 },
                { "name": "مشروم", "price": 10 },
                { "name": "صوص ثوم", "price": 4 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": 5,
      "name_ar": "وجبات",
      "name_en": "Meals",
      "name_ru": "",
      "items": [
        {
          "id": 18,
          "name_ar": "وجبة سمك كاملة",
          "description_ar": "سمك مشوي مع أرز وسلطة وطحينة وخبز",
          "price": 110,
          "image": "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=300",
          "is_available": true,
          "options": [
            {
              "title": "نوع السمك",
              "required": true,
              "multi": false,
              "items": [
                { "name": "بلطي", "price": 0 },
                { "name": "بوري", "price": 15 },
                { "name": "دنيس", "price": 30 },
                { "name": "شعري", "price": 20 }
              ]
            },
            {
              "title": "الأرز",
              "required": true,
              "multi": false,
              "items": [
                { "name": "بسمتي", "price": 0 },
                { "name": "صيادية", "price": 5 }
              ]
            }
          ]
        },
        {
          "id": 19,
          "name_ar": "وجبة جمبري",
          "description_ar": "جمبري مقلي مع الأرز والسلطة والطحينة",
          "price": 145,
          "image": "https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "نصف كيلو", "price": 0 },
                { "name": "كيلو", "price": 90 }
              ]
            },
            {
              "title": "طريقة التحضير",
              "required": true,
              "multi": false,
              "items": [
                { "name": "مقلي", "price": 0 },
                { "name": "مشوي", "price": 10 },
                { "name": "بالثوم والزبدة", "price": 15 }
              ]
            }
          ]
        },
        {
          "id": 20,
          "name_ar": "وجبة مشويات",
          "description_ar": "تشكيلة مشويات مع الأرز والسلطة والطحينة",
          "price": 175,
          "image": "https://images.unsplash.com/photo-1544025162-d76694265947?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فردي", "price": 0 },
                { "name": "دبل", "price": 90 }
              ]
            },
            {
              "title": "النوع",
              "required": true,
              "multi": true,
              "items": [
                { "name": "كباب", "price": 0 },
                { "name": "كفتة", "price": 0 },
                { "name": "شيش طاووق", "price": 0 },
                { "name": "ريش", "price": 25 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": 6,
      "name_ar": "أرز ومكرونة",
      "name_en": "Rice & Pasta",
      "name_ru": "",
      "items": [
        {
          "id": 21,
          "name_ar": "أرز صيادية",
          "description_ar": "أرز صيادية بالبصل والسمك المدخن",
          "price": 45,
          "image": "https://images.unsplash.com/photo-1596797038530-2c107229654b?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "صغير", "price": 0 },
                { "name": "كبير", "price": 15 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "جمبري", "price": 25 },
                { "name": "كاليماري", "price": 20 },
                { "name": "سمك مشوي", "price": 30 },
                { "name": "صوص حار", "price": 3 }
              ]
            }
          ]
        },
        {
          "id": 22,
          "name_ar": "أرز بسمتي",
          "description_ar": "أرز بسمتي متبل ومطهو بطريقة خاصة",
          "price": 35,
          "image": "https://images.unsplash.com/photo-1512058564366-18510be2db19?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "صغير", "price": 0 },
                { "name": "كبير", "price": 12 }
              ]
            }
          ]
        },
        {
          "id": 23,
          "name_ar": "مكرونة بالجمبري",
          "description_ar": "مكرونة مع الجمبري والخضروات والصوص الخاص",
          "price": 95,
          "image": "https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=300",
          "is_available": true,
          "options": [
            {
              "title": "نوع المكرونة",
              "required": true,
              "multi": false,
              "items": [
                { "name": "سباجيتي", "price": 0 },
                { "name": "بيني", "price": 0 },
                { "name": "فيتوتشيني", "price": 5 }
              ]
            },
            {
              "title": "الصوص",
              "required": true,
              "multi": false,
              "items": [
                { "name": "أحمر", "price": 0 },
                { "name": "وايت صوص", "price": 10 },
                { "name": "كريمي حار", "price": 10 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": 7,
      "name_ar": "سلطات",
      "name_en": "Salads",
      "name_ru": "",
      "items": [
        {
          "id": 24,
          "name_ar": "سلطة خضراء",
          "description_ar": "خضروات طازجة مع صوص الليمون",
          "price": 20,
          "image": "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 10 }
              ]
            },
            {
              "title": "الصوص",
              "required": true,
              "multi": false,
              "items": [
                { "name": "ليمون وزيت", "price": 0 },
                { "name": "طحينة", "price": 3 },
                { "name": "مايونيز", "price": 4 }
              ]
            }
          ]
        },
        {
          "id": 25,
          "name_ar": "سلطة سي فود",
          "description_ar": "تشكيلة من المأكولات البحرية مع الخضروات",
          "price": 65,
          "image": "https://images.unsplash.com/photo-1547592180-85f173990554?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 20 }
              ]
            },
            {
              "title": "الإضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "جمبري", "price": 20 },
                { "name": "كاليماري", "price": 15 },
                { "name": "تونة", "price": 10 }
              ]
            }
          ]
        },
        {
          "id": 26,
          "name_ar": "سلطة طحينة",
          "description_ar": "طحينة كريمية مع الليمون والثوم",
          "price": 18,
          "image": "https://images.unsplash.com/photo-1601050690117-94f5f6fa8bd7?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "صغير", "price": 0 },
                { "name": "كبير", "price": 8 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": 8,
      "name_ar": "مشروبات",
      "name_en": "Drinks",
      "name_ru": "",
      "items": [
        {
          "id": 27,
          "name_ar": "كوكاكولا",
          "description_ar": "مشروب غازي منعش",
          "price": 15,
          "image": "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "صغير 250 مل", "price": 0 },
                { "name": "وسط 500 مل", "price": 5 },
                { "name": "كبير 1 لتر", "price": 10 }
              ]
            },
            {
              "title": "النوع",
              "required": true,
              "multi": false,
              "items": [
                { "name": "عادي", "price": 0 },
                { "name": "دايت", "price": 0 },
                { "name": "زيرو", "price": 0 }
              ]
            }
          ]
        },
        {
          "id": 28,
          "name_ar": "عصير برتقال",
          "description_ar": "عصير برتقال طازج 100%",
          "price": 25,
          "image": "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 10 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "سكر إضافي", "price": 0 },
                { "name": "بدون سكر", "price": 0 },
                { "name": "ثلج إضافي", "price": 0 }
              ]
            }
          ]
        },
        {
          "id": 29,
          "name_ar": "مانجو",
          "description_ar": "عصير مانجو طازج وكريمي",
          "price": 30,
          "image": "https://images.unsplash.com/photo-1605027990121-cbae9c3c8b4a?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "وسط", "price": 0 },
                { "name": "كبير", "price": 12 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "سكر", "price": 0 },
                { "name": "آيس كريم", "price": 15 }
              ]
            }
          ]
        },
        {
          "id": 30,
          "name_ar": "مياه معدنية",
          "description_ar": "مياه معدنية طبيعية",
          "price": 10,
          "image": "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=300",
          "is_available": true,
          "options": []
        }
      ]
    },
    {
      "id": 9,
      "name_ar": "حلويات",
      "name_en": "Desserts",
      "name_ru": "",
      "items": [
        {
          "id": 31,
          "name_ar": "أم علي",
          "description_ar": "حلوى شرقية بالحليب والمكسرات",
          "price": 40,
          "image": "https://images.unsplash.com/photo-1587314168485-3236d6710814?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فردي", "price": 0 },
                { "name": "عائلي", "price": 30 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "مكسرات إضافية", "price": 10 },
                { "name": "قشطة", "price": 8 },
                { "name": "زبيب", "price": 5 }
              ]
            }
          ]
        },
        {
          "id": 32,
          "name_ar": "رز بلبن",
          "description_ar": "رز بلبن شرقي بالقشطة",
          "price": 20,
          "image": "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فردي", "price": 0 },
                { "name": "كبير", "price": 12 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "قشطة", "price": 6 },
                { "name": "مكسرات", "price": 5 },
                { "name": "عسل نحل", "price": 4 }
              ]
            }
          ]
        },
        {
          "id": 33,
          "name_ar": "كنافة",
          "description_ar": "كنافة شرقية بالقشطة والمكسرات",
          "price": 45,
          "image": "https://images.unsplash.com/photo-1579888944880-d98341245702?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فردي", "price": 0 },
                { "name": "كبير", "price": 25 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "قشطة", "price": 8 },
                { "name": "مكسرات", "price": 10 },
                { "name": "آيس كريم", "price": 15 }
              ]
            }
          ]
        },
        {
          "id": 34,
          "name_ar": "تشيز كيك",
          "description_ar": "تشيز كيك كريمي مع صوص الفراولة",
          "price": 55,
          "image": "https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الصوص",
              "required": true,
              "multi": false,
              "items": [
                { "name": "فراولة", "price": 0 },
                { "name": "شوكولاتة", "price": 5 },
                { "name": "كراميل", "price": 5 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": 10,
      "name_ar": "عروض ووجبات عائلية",
      "name_en": "Offers & Family Meals",
      "name_ru": "",
      "items": [
        {
          "id": 35,
          "name_ar": "وجبة عائلية سي فود",
          "description_ar": "تشكيلة كبيرة من السمك والجمبري والكاليماري مع الأرز والسلطة",
          "price": 450,
          "image": "https://images.unsplash.com/photo-1547592180-85f173990554?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "تكفي 3 أفراد", "price": 0 },
                { "name": "تكفي 5 أفراد", "price": 180 }
              ]
            },
            {
              "title": "نوع الأرز",
              "required": true,
              "multi": false,
              "items": [
                { "name": "بسمتي", "price": 0 },
                { "name": "صيادية", "price": 10 },
                { "name": "مشكل", "price": 15 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "طحينة", "price": 10 },
                { "name": "سلطة", "price": 10 },
                { "name": "بطاطس", "price": 15 },
                { "name": "مشروب 1 لتر", "price": 20 }
              ]
            }
          ]
        },
        {
          "id": 36,
          "name_ar": "عرض العائلة المشوي",
          "description_ar": "مشويات مشكلة مع الأرز والسلطات والخبز والمشروبات",
          "price": 500,
          "image": "https://images.unsplash.com/photo-1544025162-d76694265947?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الحجم",
              "required": true,
              "multi": false,
              "items": [
                { "name": "4 أفراد", "price": 0 },
                { "name": "6 أفراد", "price": 180 }
              ]
            },
            {
              "title": "نوع المشويات",
              "required": true,
              "multi": true,
              "items": [
                { "name": "كباب", "price": 0 },
                { "name": "كفتة", "price": 0 },
                { "name": "شيش طاووق", "price": 0 },
                { "name": "ريش", "price": 30 }
              ]
            },
            {
              "title": "إضافات",
              "required": false,
              "multi": true,
              "items": [
                { "name": "أرز كبير", "price": 25 },
                { "name": "سلطة كبيرة", "price": 15 },
                { "name": "طحينة", "price": 8 },
                { "name": "مشروب 1 لتر", "price": 20 }
              ]
            }
          ]
        },
        {
          "id": 37,
          "name_ar": "عرض شخصين",
          "description_ar": "وجبتان رئيسيتان مع أرز وسلطة ومشروبين",
          "price": 280,
          "image": "https://images.unsplash.com/photo-1547592180-85f173990554?w=300",
          "is_available": true,
          "options": [
            {
              "title": "الوجبات",
              "required": true,
              "multi": true,
              "items": [
                { "name": "سمك مشوي", "price": 0 },
                { "name": "جمبري", "price": 30 },
                { "name": "فيليه سمك", "price": 20 },
                { "name": "مشويات مشكلة", "price": 40 }
              ]
            },
            {
              "title": "الأرز",
              "required": true,
              "multi": false,
              "items": [
                { "name": "بسمتي", "price": 0 },
                { "name": "صيادية", "price": 5 }
              ]
            }
          ]
        }
      ]
    }
    ];

    db.all("SELECT id FROM restaurants", [], (err, restaurants) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "حدث خطأ في قاعدة البيانات"
            });
        }

        if (!restaurants || restaurants.length === 0) {
            return res.json({
                success: true,
                message: "لا توجد مطاعم لتحديث المنيو",
                count: 0
            });
        }

        const menuJson = JSON.stringify(menu);
        let completed = 0;
        let hasError = false;

        restaurants.forEach(({ id }) => {
            db.run(
                "UPDATE restaurants SET menu = ? WHERE id = ?",
                [menuJson, id],
                (err) => {
                    if (err) {
                        hasError = true;
                        console.error(`Menu Error ${id}:`, err);
                    }

                    completed++;

                    if (completed === restaurants.length) {
                        if (hasError) {
                            return res.status(500).json({
                                success: false,
                                message: "تم تحديث بعض المطاعم وحدث خطأ في البعض الآخر"
                            });
                        }

                        res.json({
                            success: true,
                            message: "تم إضافة المنيو لجميع المطاعم",
                            count: restaurants.length
                        });
                    }
                }
            );
        });
    });
});
module.exports = router;