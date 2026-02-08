# Gazzer API Collections - Organized by Feature

## ✅ What You Have

**58 JSON files** - Each file is a complete Postman collection containing all related endpoints for a specific feature.

For example:
- **Client_Addresses.json** contains ALL 6 address-related endpoints
- **Cart.json** contains ALL 8 cart operations
- **Orders.json** contains ALL 12 order management endpoints

## 📋 Complete List of Collections

### 🔐 Authentication & User Management (10 collections, 35 endpoints)
- **Client_Auth_Register.json** (7 endpoints) - Registration, OTP, phone verification
- **Client_Auth_Login.json** (1 endpoint) - User login
- **Client_Auth_Logout.json** (1 endpoint) - User logout
- **Client_Auth_Refresh_Token.json** (1 endpoint) - Refresh auth token
- **Client_Auth_Social_SignIn.json** (4 endpoints) - Social authentication flow
- **Client_Auth_Reset_Password.json** (3 endpoints) - Password reset flow
- **Client_Auth_Restore_Account.json** (3 endpoints) - Account restoration
- **Client_Auth_update_fcm.json** (1 endpoint) - Firebase token update
- **Client_Profile.json** (7 endpoints) - Profile management
- **Client_Addresses.json** (6 endpoints) - Address CRUD operations

### 🏪 Restaurants & Stores (14 collections, 24 endpoints)
- **Restaurant_Plates.json** (6 endpoints) - Menu items and plates
- **Restaurant_Plates_Categories.json** (4 endpoints) - Plate categories
- **Restaurant_Get__Restaurants.json** (1 endpoint)
- **Restaurant_Get__Restaurant.json** (1 endpoint)
- **Restaurant_Get_Single_Restaurant.json** (1 endpoint)
- **Restaurant_Get_Top_Rated_Restaurants.json** (1 endpoint)
- **Restaurant_Get_Restaurants_By_Category.json** (1 endpoint)
- **Restaurant_Get_Restaurants_Has_Offers.json** (1 endpoint)
- **Store_Store_Items.json** (4 endpoints) - Store inventory
- **Store_Get_Store.json** (1 endpoint)
- **Store_Get_Stores_Grouped_By_Item_Category.json** (1 endpoint)
- **Store_Get_Stores_For_(Store_-_Item)_Category.json** (1 endpoint)
- **Stores_Categoies.json** (1 endpoint)
- **Catalog_Generic_Items.json** (1 endpoint)
- **Catalog_Generic_Item_Categories.json** (2 endpoints)

### 🛒 Shopping Flow (3 collections, 23 endpoints)
- **Cart.json** (8 endpoints) - Complete cart management
- **Orders.json** (12 endpoints) - Checkout, tracking, reviews, PDF
- **Favorite.json** (3 endpoints) - Wishlist management

### 💰 Payment & Rewards (4 collections, 22 endpoints)
- **wallet.json** (6 endpoints) - Wallet balance, transactions, cards
- **payment.json** (7 endpoints) - Payment processing
- **loyalty.json** (4 endpoints) - Loyalty points program
- **Vouchers.json** (5 endpoints) - Voucher management

### 📱 App UI Pages (3 collections, 20 endpoints)
- **App_Pages_Home_Page.json** (8 endpoints) - Home widgets and sections
- **App_Pages_Restaurants.json** (5 endpoints) - Restaurant pages
- **App_Pages_Store.json** (7 endpoints) - Store pages

### 💬 Customer Support (5 collections, 10 endpoints)
- **Support_Module_Support_Chat.json** (4 endpoints) - Live chat
- **Support_Module_FAQ.json** (4 endpoints) - Help articles
- **Support_Module_FAQ_Rating.json** (1 endpoint)
- **Support_Module_Support.json** (1 endpoint)
- **Support_Module_complaints.json** (1 endpoint)

### 🎁 Referrals & Sharing (2 collections, 7 endpoints)
- **Referral_and_share_Referral.json** (4 endpoints) - Referral program
- **Referral_and_share_Share.json** (3 endpoints) - Content sharing

### 🌍 Global & Utilities (8 collections, 11 endpoints)
- **Global_Search.json** (1 endpoint)
- **Global_App_Settings.json** (1 endpoint)
- **Global_Time_On_Server.json** (1 endpoint)
- **Global_Reasons.json** (1 endpoint)
- **Provinces.json** (4 endpoints) - Location services
- **Banners.json** (3 endpoints) - Promotional banners
- **Lists.json** (1 endpoint)

### ⚙️ Admin & Core (6 collections, 11 endpoints)
- **core_import.json** (5 endpoints) - Data import
- **core_artisan.json** (3 endpoints) - Cache & logs
- **core_clear-all.json** (1 endpoint)
- **core_get_log_Copy.json** (1 endpoint)
- **core_remove_log.json** (1 endpoint)

### 🧪 Testing (4 collections, 4 endpoints)
- **New_Request.json** (1 endpoint)
- **New_Request_Copy.json** (1 endpoint)
- **New_Request_Copy_2.json** (1 endpoint)
- **send_Firebase_Notification.json** (1 endpoint)

## 🚀 How to Use

### Step 1: Import into Postman
1. Open Postman
2. Click **Import** button
3. Select the JSON files you need (or select all 58)
4. Each file imports as a separate collection

### Step 2: Configure Environment
Create a Postman environment with these variables:
```
BASE = https://your-api-url.com
TOKEN = your-auth-token-here
```

### Step 3: Start Testing!
- Each collection contains all related endpoints
- Test complete workflows without switching collections
- Example: Import `Client_Auth_Register.json` + `Client_Auth_Login.json` to test full auth flow

## 📊 Summary Statistics

| Category | Collections | Endpoints |
|----------|-------------|-----------|
| Auth & User | 10 | 35 |
| Restaurants & Stores | 14 | 24 |
| Shopping | 3 | 23 |
| Payment & Rewards | 4 | 22 |
| App Pages | 3 | 20 |
| Support | 5 | 10 |
| Referrals | 2 | 7 |
| Global | 8 | 11 |
| Admin | 6 | 11 |
| Testing | 4 | 4 |
| **TOTAL** | **58** | **170** |

## ✨ Key Features

✅ **Grouped by Feature** - All related endpoints in one file
✅ **Complete Workflows** - Test entire features without switching
✅ **Bearer Auth Included** - Authentication pre-configured
✅ **Environment Variables** - {{BASE}} and {{TOKEN}} ready
✅ **Response Examples** - Sample responses where available
✅ **Clean Naming** - Easy to find what you need

---

**Ready to import into Postman and start testing!**
