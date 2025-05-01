---
title: "Offset vs Cursor vs Keyset Pagination: Best Practices for Scalable APIs"
datePublished: Thu May 01 2025 07:47:13 GMT+0000 (Coordinated Universal Time)
cuid: cma52axmg000009if26je6md4
slug: offset-vs-cursor-vs-keyset-pagination
cover: https://cdn.hashnode.com/res/hashnode/image/stock/unsplash/dsvJgiBJTOs/upload/4290081b9c76036b46bec8c47c8fc671.jpeg
tags: nodejs, software-architecture, webdev, scalability, pagination, api-design, backend-engineering

---

Before we dig deep into the details. Let’s break down on what problem this article really addresses, what solution works best and what are the real world use cases —

* 🧵 Problem: `GET /items` with 10,000 records? Brutal.
    
* 📘 Solution: Explore pros/cons of offset, cursor-based, and keyset pagination.
    
* 🧠 Use cases: infinite scroll, large list APIs.
    

Let’s begin…

## 1\. 🔥 **Introduction: Why Pagination Matters**

* Brief on modern APIs fetching massive datasets: products, users, posts, etc.
    
* Without pagination:
    
    * Slow response times
        
    * High memory usage
        
    * Risk of app crashes
        
* Pagination isn’t one-size-fits-all. Let's compare the **three most popular strategies**.
    

## 2\. 🧮 **Offset Pagination (LIMIT/OFFSET)**

### ✅ How it works:

```sql
SELECT * FROM products ORDER BY id LIMIT 10 OFFSET 30;
```

### ✔️ Pros:

* Simple to implement
    
* Easy to understand for devs
    
* Works well for small datasets
    

### ❌ Cons:

* Expensive on large datasets (DB still scans all skipped rows)
    
* Risk of **duplicate or missing data** when records are inserted/deleted during pagination
    
* Not ideal for infinite scroll or real-time apps
    

### 🛠️ When to use:

* Admin dashboards
    
* One-time exports
    
* Non-realtime tables with moderate data
    

## 3\. 🧭 **Cursor-Based Pagination (a.k.a. Seek Method)**

### ✅ How it works:

```sql
SELECT * FROM users WHERE id > 100 ORDER BY id ASC LIMIT 10;
```

* Instead of skipping rows, it uses a **reference ("cursor")** to fetch the next set.
    

### ✔️ Pros:

* Much **faster** on large datasets
    
* Stable even if records are inserted or deleted
    
* Ideal for real-time pagination or infinite scroll
    

### ❌ Cons:

* Harder to implement for multi-column sorts
    
* Can’t jump to arbitrary page (e.g., page 500)
    

### 🛠️ When to use:

* Public feeds (e.g. Twitter, Reddit)
    
* Infinite scrolling
    
* APIs with fast UX requirements
    

## 4\. 🔑 **Keyset Pagination (a refined Cursor Pagination)**

> "Keyset" is the more academic name for cursor pagination when it involves **compound primary keys or sort keys**.

### ✅ How it works:

```sql
SELECT * FROM posts WHERE (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT 10;
```

* Uses **multiple fields** as cursors to avoid sorting conflicts
    

### ✔️ Pros:

* Most **reliable** and **performant** method
    
* Eliminates page drift completely
    
* Fully stable even during data changes
    

### ❌ Cons:

* Cannot jump to random page
    
* Requires understanding of ordering logic
    
* Slightly harder to paginate backward
    

### 🛠️ When to use:

* Large datasets with dynamic insertions
    
* Financial records, event logs, social media feeds
    

## 5\. 🧪 **Real-World Code Comparisons**

### REST API: Offset Example

```http
GET /products?limit=10&offset=30
```

### REST API: Cursor Example

```http
GET /posts?after=eyJpZCI6MTAwMX0=
```

* `after` is a **Base64 encoded cursor**, like `{ "id": 1001 }`
    

### MongoDB Example (Cursor style)

```javascript
db.posts.find({ 
  _id: {
    $gt: ObjectId("...")
  }
}).limit(10);
```

## 6\. 🧠 **Which One Should You Use?**

| Criteria | Offset | Cursor | Keyset |
| --- | --- | --- | --- |
| **Ease of use** | ✅ ✅ ✅ | ✅ ✅ | ✅ |
| **Performance (large data)** | ❌ | ✅ | ✅ ✅ ✅ |
| **Supports page jump** | ✅ ✅ ✅ | ❌ | ❌ |
| **Consistent on changing data** | ❌ | ✅ ✅ ✅ | ✅ ✅ ✅ |
| **Best for infinite scroll** | ❌ | ✅ ✅ | ✅ ✅ ✅ |

## 7\. 🚨 **Common Pitfalls to Avoid**

* **Sorting mismatch:** Always match `ORDER BY` with your cursor condition.
    
* **Stateless cursors:** Don’t store pagination state server-side — encode it in the cursor.
    
* **Unstable fields:** Never paginate by non-unique or volatile fields like `name`.
    

## 8\. ✅ **Conclusion: Pick the Right Tool for the Job**

* Offset is easy, but fragile for large or live data.
    
* Cursor is efficient, ideal for real-time apps.
    
* Keyset is rock-solid for large-scale, high-integrity pagination needs.
    

> Choose your pagination based on **UX goals, dataset size**, and **data volatility**.

# 📣 Call to Action:

*"Which pagination method do you use in your APIs today? Ever had to switch strategies mid-project? Share your experience below!"*