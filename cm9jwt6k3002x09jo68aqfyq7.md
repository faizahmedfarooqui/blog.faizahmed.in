---
title: "Part 10: Adding Network Superpowers"
datePublished: Wed Apr 16 2025 12:30:17 GMT+0000 (Coordinated Universal Time)
cuid: cm9jwt6k3002x09jo68aqfyq7
slug: part-10-adding-network-superpowers
cover: https://cdn.hashnode.com/res/hashnode/image/stock/unsplash/Y7GUOQ83OMg/upload/3a599ce4759646e2a14841eabee29333.jpeg
tags: openstack, maas, metal-to-cloud, juju

---

In Part 9, we successfully deployed OVN, establishing the Software-Defined Networking layer for our cloud.

Virtual machines can now be connected, but modern cloud platforms offer more than just basic connectivity. Users expect higher-level services like load balancing and automated DNS.

In this post, we'll deploy OpenStack's solutions for these: Octavia (LBaaS) and Designate (DNSaaS). We'll also deploy the Ceph RadosGW to provide S3/Swift-compatible object storage access.

## Why LBaaS and DNSaaS? 🤔

* **Load Balancer as a Service (LBaaS):** Essential for distributing incoming application traffic across multiple backend VM instances. This improves application scalability (handle more load) and reliability (survive single instance failures). Octavia provides this on-demand within OpenStack.
    
* **DNS as a Service (DNSaaS):** Manually managing DNS records for cloud resources is tedious and error-prone. Designate integrates with OpenStack, allowing users (and services) to manage DNS zones and records programmatically, often automatically creating records for new VMs.
    

## Octavia: Your On-Demand Load Balancers ⚖️

Octavia works by spinning up dedicated virtual machines (called "amphorae") that run load balancing software like HAProxy.

1. **Deployment Strategy:** We'll deploy the Octavia core service HA into LXD containers on our miscellaneous/control nodes (`5,6,7`).
    
    ```bash
    # Deploy Octavia API/worker services (assuming HA)
    # Note: '--config octavia.yaml' would contain VIP etc.
    juju deploy -n 3 --to lxd:5,lxd:6,lxd:7 --channel 2023.2/stable octavia octavia
    
    # Deploy MySQL Router for Octavia
    juju deploy --channel 8.0/stable mysql-router octavia-mysql-router
    ```
    
2. **Amphora Image Handling:** Octavia needs a specialized VM image (the amphora image) available in Glance. The `octavia-diskimage-retrofit` charm helps manage this.
    
    ```bash
    # Deploy the retrofit charm (runs once typically)
    juju deploy --channel 2023.2/stable octavia-diskimage-retrofit
    # Configure the image tag (from our main config.yaml)
    juju config octavia-diskimage-retrofit amp-image-tag=octavia-amphora
    # Relate it to Glance (assuming a base Ubuntu image exists)
    # NOTE: Specific base image name might be needed depending on charm version/docs.
    # You might need manual steps to create/upload the correct base image first.
    juju integrate octavia-diskimage-retrofit:glance glance:juju-info
    ```
    
    * *Important:* Ensure a suitable base image (e.g., Ubuntu Cloud image) is in Glance for the retrofit charm to use. Check the specific charm documentation for prerequisites.
        
3. **Integrations:** Connect Octavia to the rest of the cloud.
    
    ```bash
    # Database
    juju integrate octavia-mysql-router:db-router mysql-innodb-cluster:db-router
    juju integrate octavia-mysql-router:shared-db octavia:shared-db
    # Identity
    juju integrate octavia:identity-service keystone:identity-service
    # Message Queue
    juju integrate octavia:amqp rabbitmq-server:amqp
    # Certificates
    juju integrate octavia:certificates vault:certificates
    # Load Balancer network connectivity (relies on Neutron)
    juju integrate octavia:neutron neutron-api:neutron-load-balancer
    ```
    

## Designate: Automated DNS Management 🗺️

Designate provides the DNSaaS API, and typically uses a backend like BIND to serve the actual DNS requests.

1. **Deployment Strategy:** We'll deploy the Designate API and the BIND backend. Let's deploy 2 units of each for HA into LXD containers on misc nodes (`5,6`).
    
    ```bash
    # Deploy Designate API
    # Note: '--config designate.yaml' would contain VIP, nameserver list etc.
    juju deploy -n 2 --to lxd:5,lxd:6 --channel 2023.2/stable --config designate.yaml designate
    
    # Deploy Designate's MySQL Router
    juju deploy --channel 8.0/stable mysql-router designate-mysql-router
    
    # Deploy BIND backend
    juju deploy -n 2 --to lxd:5,lxd:6 --channel yoga/stable designate-bind designate-bind
    ```
    
    * Note the channel for `designate-bind` might differ; check Charmhub for the version compatible with your Designate/OpenStack release.
        
2. **Configuration:** Ensure the designate charm is configured with the correct authoritative nameservers (this tells OpenStack which nameservers Designate manages). This comes from our `config.yaml`.
    
    ```bash
    # Example from config.yaml: nameservers: ns1.example.com. ns2.example.com.
    juju config designate nameservers='ns1.example.com. ns2.example.com.'
    ```
    
3. **Integrations:** Connect Designate API, BIND, and the core services.
    
    ```bash
    # Database
    juju integrate designate-mysql-router:db-router mysql-innodb-cluster:db-router
    juju integrate designate-mysql-router:shared-db designate:shared-db
    # Identity
    juju integrate designate:identity-service keystone:identity-service
    # Message Queue
    juju integrate designate:amqp rabbitmq-server:amqp
    # Certificates
    juju integrate designate:certificates vault:certificates
    # Link API to Backend
    juju integrate designate:dns-backend designate-bind:dns-backend
    ```
    

## Ceph RadosGW: S3/Swift Object Storage Gateway 💾

While Glance uses Ceph for image storage and Cinder for block storage, we also want direct S3/Swift compatible object storage access for users and applications. Ceph RadosGW (RGW) provides this gateway.

1. **Deployment:** We deploy a single instance into LXD on machine `6` as per the user command list. (For HA RGW, you'd deploy multiple units behind a load balancer like HAProxy or Keep-alived).
    
    ```bash
    # Deploy RGW applying config for VIP, tenant namespaces etc.
    # '--config ceph-rgw.yaml' contains options from main config.yaml
    juju deploy --to lxd:6 --channel quincy/stable --config ceph-rgw.yaml ceph-radosgw
    ```
    
2. **Integrations:** Connect RGW to Ceph and Keystone.
    
    ```bash
    # Connect to the Ceph cluster monitors
    juju integrate ceph-radosgw:mon ceph-mon:radosgw
    # Connect to Keystone for S3/Swift user authentication
    juju integrate ceph-radosgw:identity-service keystone:identity-service
    ```
    
    Users can now use S3/Swift tools with their Keystone credentials to access object storage, with the data stored securely in our Ceph cluster.
    

## Verification ✅

Check the status of the newly deployed services:

```bash
juju status octavia designate designate-bind ceph-radosgw
```

Look for active units and successful relations. You can also check if the services registered their endpoints correctly in Keystone:

```bash
juju run keystone/leader 'openstack service list'
# Look for services like 'octavia' (load-balancer), 'designate' (dns), 'swift'/'s3' (object-store)
```

## Conclusion ✨

Our OpenStack cloud is now significantly more powerful! We've added key "as-a-Service" components using Juju:

* **Octavia** for Load Balancing
    
* **Designate** for DNS Management
    
* **Ceph RadosGW** for S3/Swift Object Storage
    

These services elevate the platform beyond basic IaaS, providing capabilities users expect from a modern cloud.

With the infrastructure and core services largely in place, we're finally ready to interact with the cloud as a user would.

In Part 11, we'll explore the Horizon dashboard, create our first networks and VMs, and see the whole system working together.