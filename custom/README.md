# Importer script for uploading content type definitions and bulk content into a Cloud CMS project.

The importer script requires dependencies to be installed:

   npm install

There is a help message available to explain the available options:

    node import -h
    
Prior to importing content, the content model definitions should be installed.
This script can install the defintion files but does not yet install forms. That
will need to be done manually.

First list the available definitions:

    node import -l

Import a content definition. This example loads the article content type (identified by qname):

    node import -t "ers:article"

The importer will not overwrite a defintion so you may need to delete the defition in the Cloud CMS UI if you are updating.    

## importing content
Run the importer once for each file to import
node import -x ./docs/import/respiratory-worldwide-column.xml -t "ers:article" -p contentType -v article

### Import ERS content from the following files (supplied by ERS):

"news archive" articles
./docs/import/news-archive.csv
node import -c ./docs/import/news-archive.csv -t "ers:article" -p contentType -v article -p type -v News --category News

"EU policy" articles
./docs/import/ERS-andEU-policy-development).csv
node import -c ./docs/import/ERS-andEU-policy-development).csv -t "ers:article" -p contentType -v article --category "UA Affairs"

"leaders" blog:
./docs/import/leaders-blog.xml
node import -x ./docs/import/leaders-blog.xml -t "ers:article" -p contentType -v article -p type -v News --category "Respiratory Matters"

"respiratory world wide" articles:
./docs/import/respiratory-worldwide-column.xml
node import -x ./docs/import/respiratory-worldwide-column.xml -t "ers:article" -p contentType -v article -p type -v News --category "Respiratory World Wide"
