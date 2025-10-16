# Store Null Pointer

This is about persisting that there is no data. When a PsotgreSQL DB is used to persist data coming from other origin data service, it is critical to make the difference between not finding something which would trigger a read operation from origin servixces, from knowing that no data was found in the origin data service, such that we don't waste time asking the origin service again and again

- [The "nil" UUID is 00000000-0000-0000-0000-000000000000 ; that is, all clear bits.](https://en.wikipedia.org/wiki/Universally_unique_identifier)
    - []
- [How do I handle many NULL-able foreign keys in Postgres?](https://stackoverflow.com/questions/34176127/how-do-i-handle-many-null-able-foreign-keys-in-postgres)
- [Foreign Key with a Null Value in PostgreSQL](https://www.geeksforgeeks.org/postgresql/foreign-key-with-a-null-value-in-postgresql/)
- [sql represent null join to-many foreign key vs not found](https://www.google.com/search?q=sql+represent+null+join+to-many+foreign+key+vs+not+found%C2%A0&client=safari&sca_esv=3e7026d05fa1ec3b&rls=en&biw=2055&bih=1182&ei=jjabZ7OXJcfAp84P4pOXyA4&ved=0ahUKEwizlubpgZ2LAxVH4MkDHeLJBek4FBDh1QMIEA&uact=5&oq=sql+represent+null+join+to-many+foreign+key+vs+not+found%C2%A0&gs_lp=Egxnd3Mtd2l6LXNlcnAiOnNxbCByZXByZXNlbnQgbnVsbCBqb2luIHRvLW1hbnkgZm9yZWlnbiBrZXkgdnMgbm90IGZvdW5kwqAyCBAAGIAEGKIEMggQABiiBBiJBTIFEAAY7wUyCBAAGIAEGKIESLwNUK8DWMYKcAF4AZABAJgBqAGgAc8GqgEDMi41uAEDyAEA-AEBmAICoAKIAcICChAAGLADGNYEGEeYAwCIBgGQBgiSBwMxLjGgB-8a&sclient=gws-wiz-serp)
- 