#!/bin/bash

CWD=$(pwd)

cd ..

rm -rf vite/ vite-src/

git clone --no-checkout --depth 1 --filter=tree:0 --sparse https://github.com/vitejs/vite.git vite-src

cd vite-src/

git sparse-checkout set packages/vite/

git checkout

cd ..

cp -rf vite-src/packages/vite/ vite/

rm -rf vite-src/

cd vite

cd "$CWD"
